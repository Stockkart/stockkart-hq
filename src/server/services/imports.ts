import { createHash } from "node:crypto";

import { type SQL, sql } from "drizzle-orm";
import { generateNKeysBetween } from "fractional-indexing";
import { z } from "zod";

import { canonicalJson } from "@/lib/canonical-json";
import {
  IMPORT_REPORT_ERRORS_MAX,
  IMPORT_REPORT_MAX_BYTES,
  IMPORT_STATUSES,
} from "@/lib/imports/constants";
import { type ImportField } from "@/lib/imports/fields";
import { type applyImportInput, type previewImportInput } from "@/lib/imports/schemas";
import { type ImportIssueValues, validateImportRows } from "@/lib/imports/validate";
import {
  type ImportApplyResult,
  type ImportHistoryItem,
  type ImportPreview,
} from "@/lib/imports/views";
import { type IssueType, STATUS_CATEGORIES, STATUS_DEFAULT_FOR } from "@/lib/issues/constants";
import { extractIssueRefs, formatIssueKey } from "@/lib/issues/keys";
import { extractPlainText, type RichTextDoc, type RichTextNode } from "@/lib/rich-text";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";

import { conflict, invalid, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";
import { type QueryOptions } from "./issue-queries";
import { notificationsInsert } from "./notifications";
import { allInOrder } from "./parallel";
import { type IdRef, rowsOf } from "./sql";

export type PreviewImportData = z.output<typeof previewImportInput>;
export type ApplyImportData = z.output<typeof applyImportInput>;

export interface ImportServiceOptions {
  /** Apply runs two statements in one transaction (see `apply`). */
  runAtomic: RunAtomic;
  read?: Read;
}

/** Attempts when a concurrent create takes the top-of-backlog ranks (as `createIssue`). */
const RANK_ATTEMPTS = 5;

const statusRow = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(STATUS_CATEGORIES),
  is_default_for: z.enum(STATUS_DEFAULT_FOR).nullable(),
});
const userRow = z.object({ id: z.string(), name: z.string(), email: z.string() });
const reportSchema = z.object({ hash: z.string() });
const appliedReport = z
  .object({ firstNumber: z.number().nullable(), lastNumber: z.number().nullable() })
  .partial()
  .catch({});
const importRow = z.object({
  id: z.string(),
  project_id: z.string(),
  project_key: z.string(),
  filename: z.string(),
  status: z.enum(IMPORT_STATUSES),
  row_count: z.number(),
  created_count: z.number(),
  error_count: z.number(),
  report: z.unknown(),
});
const historyRow = z.object({
  id: z.string(),
  filename: z.string(),
  status: z.enum(IMPORT_STATUSES),
  row_count: z.number(),
  created_count: z.number(),
  error_count: z.number(),
  created_by_name: z.string().nullable(),
  created_ms: z.number(),
  applied_ms: z.number().nullable(),
});

/** The fingerprint of what was previewed; apply must send exactly the same cells. */
export function importHash(fields: readonly ImportField[], rows: readonly string[][]): string {
  return createHash("sha256").update(canonicalJson({ fields, rows })).digest("hex");
}

/** Plain text → one paragraph; line breaks become hard breaks (IMP-4). */
export function plainTextDoc(text: string): RichTextDoc {
  const content: RichTextNode[] = [];
  text.split(/\r\n|\r|\n/).forEach((line, index) => {
    if (index > 0) content.push({ type: "hardBreak" });
    if (line) content.push({ type: "text", text: line });
  });
  return { type: "doc", content: [{ type: "paragraph", ...(content.length ? { content } : {}) }] };
}

/**
 * `imports.report` for a preview: the fields, the hash and the errors (row numbers and
 * messages only; a message quotes at most `IMPORT_QUOTE_MAX` characters of a cell, so no
 * row data is stored). Errors beyond `IMPORT_REPORT_ERRORS_MAX` are dropped (the counts on
 * the row stay exact), and the whole report stays under the table's 1 MB CHECK.
 */
function previewReport(
  fields: readonly ImportField[],
  hash: string,
  errors: { row: number; field: ImportField; message: string }[],
) {
  let kept = errors.slice(0, IMPORT_REPORT_ERRORS_MAX);
  const build = () => ({ fields, hash, errors: kept, truncated: kept.length < errors.length });
  while (kept.length > 0 && Buffer.byteLength(JSON.stringify(build())) >= IMPORT_REPORT_MAX_BYTES) {
    kept = kept.slice(0, Math.floor(kept.length / 2));
  }
  return build();
}

/**
 * IMP-4 CSV import of issues. The browser parses the file and sends the mapped cells; the
 * raw CSV is never stored (nor sent to R2). Preview validates every row and records an
 * `imports` row (`previewed`) with the errors; apply re-validates and creates the valid
 * rows in ONE transaction, numbering them like `createIssue` (one bump of
 * `projects.issue_counter` for the whole batch, under its row lock), and marks the import
 * `applied` in that transaction, so applying the same import twice creates nothing.
 */
export function createImportService(db: AppDatabase, options: ImportServiceOptions) {
  const read = options.read ?? directRead;

  async function lookups(projectId: IdRef) {
    const [statusResult, userResult, keyResult] = await Promise.all([
      read(
        db.execute(sql`
          SELECT id::text, name, category::text AS category,
            is_default_for::text AS is_default_for
          FROM statuses WHERE project_id = ${projectId} ORDER BY position
        `),
      ),
      read(db.execute(sql`SELECT id::text, name, email FROM users ORDER BY name`)),
      read(db.execute(sql`SELECT key FROM projects`)),
    ]);
    return {
      statuses: rowsOf(statusResult, statusRow),
      users: rowsOf(userResult, userRow),
      projectKeys: rowsOf(keyResult, z.object({ key: z.string() })).map((row) => row.key),
    };
  }

  /** §4.4: Triage for bugs, Backlog for everything else; else the first status. */
  function defaultStatusId(statuses: z.infer<typeof statusRow>[], type: IssueType): string {
    const wanted = type === "bug" ? "bug" : "other";
    const status = statuses.find((row) => row.is_default_for === wanted) ?? statuses[0];
    if (!status) throw invalid("The project has no statuses; run the seed first");
    return status.id;
  }

  async function topRank(projectId: string): Promise<string | null> {
    // Deleted issues keep their rank, and ranks are unique per project, so include them.
    const [row] = rowsOf(
      await db.execute(sql`
        SELECT rank FROM issues WHERE project_id = ${projectId}::uuid ORDER BY rank LIMIT 1
      `),
      z.object({ rank: z.string() }),
    );
    return row?.rank ?? null;
  }

  async function loadImport(importId: string) {
    const [row] = rowsOf(
      await read(
        db.execute(sql`
          SELECT i.id::text, i.project_id::text, p.key AS project_key, i.filename,
            i.status::text AS status, i.row_count, i.created_count, i.error_count, i.report
          FROM imports i JOIN projects p ON p.id = i.project_id
          WHERE i.id = ${importId}::uuid AND p.archived_at IS NULL
        `),
      ),
      importRow,
    );
    if (!row) throw notFound("Import");
    return row;
  }

  function appliedResult(row: z.infer<typeof importRow>): ImportApplyResult {
    const report = appliedReport.parse(row.report);
    const key = (n: number | null | undefined) =>
      n === null || n === undefined ? null : formatIssueKey(row.project_key, n);
    return {
      created: 0,
      skipped: row.error_count,
      alreadyApplied: true,
      firstKey: key(report.firstNumber),
      lastKey: key(report.lastNumber),
    };
  }

  /** The two statements of an apply (see `apply`). */
  function applyStatements(
    actorId: string,
    row: z.infer<typeof importRow>,
    records: ReturnType<typeof toRecords>,
    skipped: number,
  ): [SQL, SQL] {
    const projectId = row.project_id;
    const n = records.length;
    const statusIds = [...new Set(records.map((record) => record.status_id))];
    const assigneeIds = [
      ...new Set(records.flatMap((record) => (record.assignee_id ? [record.assignee_id] : []))),
    ];
    const labelNames = [...new Set(records.flatMap((record) => record.labels))];
    const idList = (ids: string[]) =>
      sql`(SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;

    // 1. Claim the import (only once: `status = 'previewed'`) if every status and user the
    //    rows refer to still exists, and create the labels the rows name. Labels go first so
    //    the second statement (a fresh snapshot) sees them, including ones another request
    //    created meanwhile.
    const claim = sql`
      WITH claim AS (
        UPDATE imports SET status = 'applied', applied_at = now(), created_count = ${n}::int,
          error_count = ${skipped}::int
        WHERE id = ${row.id}::uuid AND project_id = ${projectId}::uuid AND status = 'previewed'
          AND (SELECT count(*) FROM statuses
            WHERE project_id = ${projectId}::uuid AND id IN ${idList(statusIds)})
            = ${statusIds.length}
          AND (SELECT count(*) FROM users WHERE id IN ${idList(assigneeIds)})
            = ${assigneeIds.length}
        RETURNING id
      ),
      new_labels AS (
        INSERT INTO labels (project_id, name)
        SELECT ${projectId}::uuid, value
        FROM jsonb_array_elements_text(${JSON.stringify(labelNames)}::jsonb)
        WHERE EXISTS (SELECT 1 FROM claim)
        ON CONFLICT (project_id, name) DO NOTHING
      )
      SELECT (SELECT count(*)::int FROM claim) AS claimed
    `;

    const refs = records.flatMap((record) =>
      record.refs.map((ref) => ({ issue_id: record.id, key: ref.projectKey, num: ref.number })),
    );
    const src = JSON.stringify(records.map(({ refs: _refs, ...rest }) => rest));
    // 2. Only if statement 1 claimed it in THIS transaction (`xmin`, as `saveDoc` checks):
    //    allocate N numbers in one counter bump (row lock, as `createIssue`), insert the
    //    issues and their activity, labels, watchers, notifications and mention links.
    const create = sql`
      WITH claimed AS (
        SELECT id FROM imports
        WHERE id = ${row.id}::uuid AND status = 'applied' AND xmin = pg_current_xact_id()::xid
      ),
      counter AS (
        UPDATE projects SET issue_counter = issue_counter + ${n}::int, updated_at = now()
        WHERE id = ${projectId}::uuid AND EXISTS (SELECT 1 FROM claimed)
        RETURNING issue_counter
      ),
      src AS (
        SELECT * FROM jsonb_to_recordset(${src}::jsonb) AS r(ord int, id uuid, type text,
          title text, description jsonb, description_text text, status_id uuid, priority int,
          assignee_id uuid, use_default boolean, story_points int, due_date date, rank text,
          labels jsonb)
      ),
      inserted AS (
        INSERT INTO issues (id, project_id, number, type, title, description, description_text,
          status_id, priority, assignee_id, reporter_id, story_points, due_date, rank,
          resolved_at)
        SELECT s.id, ${projectId}::uuid, c.issue_counter - ${n}::int + s.ord,
          s.type::issue_type, s.title, s.description, s.description_text, s.status_id,
          s.priority::smallint,
          -- PRJ-3: no assignee column value → the project's default assignee.
          CASE WHEN s.use_default
            THEN (SELECT default_assignee_id FROM projects WHERE id = ${projectId}::uuid)
            ELSE s.assignee_id END,
          ${actorId}::uuid, s.story_points, s.due_date, s.rank,
          -- §4.4: created straight into a done-category status counts as resolved now.
          CASE WHEN (SELECT category FROM statuses WHERE id = s.status_id) = 'done'
            THEN now() END
        FROM src s CROSS JOIN counter c
        RETURNING id, number, assignee_id
      ),
      created_activity AS (
        INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value, meta)
        SELECT 'issue', s.id, ${actorId}::uuid, 'created', s.type,
          jsonb_build_object('source', 'csv_import', 'importId', ${row.id}::text,
            'filename', ${row.filename}::text)
        FROM inserted i JOIN src s ON s.id = i.id
      ),
      label_rows AS (
        SELECT s.id AS issue_id, l.id AS label_id, l.name
        FROM src s CROSS JOIN LATERAL jsonb_array_elements_text(s.labels) AS n(name)
        JOIN labels l ON l.project_id = ${projectId}::uuid AND l.name = n.name
        WHERE EXISTS (SELECT 1 FROM inserted)
      ),
      attached AS (
        INSERT INTO issue_labels (issue_id, label_id)
        SELECT issue_id, label_id FROM label_rows
        ON CONFLICT DO NOTHING
        RETURNING issue_id, label_id
      ),
      label_activity AS (
        INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value, meta)
        SELECT 'issue', a.issue_id, ${actorId}::uuid, 'label_added', 'labels',
          a.label_id::text, jsonb_build_object('name', r.name)
        FROM attached a JOIN label_rows r ON r.issue_id = a.issue_id AND r.label_id = a.label_id
      ),
      -- ISS-11: the reporter and the assignee watch each new issue.
      auto_watch AS (
        INSERT INTO watchers (issue_id, user_id)
        SELECT DISTINCT i.id, u.user_id
        FROM inserted i, LATERAL (VALUES (${actorId}::uuid), (i.assignee_id)) AS u(user_id)
        WHERE u.user_id IS NOT NULL
        ON CONFLICT DO NOTHING
      ),
      -- NTF-1: created with someone else as the assignee (as quick create).
      assigned_notified AS (
        ${notificationsInsert({
          actorId,
          source: sql`
            SELECT i.assignee_id AS user_id, 'assigned'::text AS type,
              'issue'::text AS entity_type, i.id AS entity_id,
              'assigned:created:' || i.id::text AS event_key, '{}'::jsonb AS meta
            FROM inserted i`,
        })}
      ),
      -- ISS-7: STK-123 in a description links to that issue (as the editor's mentions).
      mention_added AS (
        INSERT INTO entity_links (from_type, from_id, to_type, to_id, origin, created_by)
        SELECT DISTINCT 'issue'::entity_type, r.issue_id, 'issue'::entity_type, t.id,
          'mention'::entity_link_origin, ${actorId}::uuid
        FROM jsonb_to_recordset(${JSON.stringify(refs)}::jsonb)
          AS r(issue_id uuid, key text, num int)
        JOIN projects p ON p.key = r.key
        JOIN issues t ON t.project_id = p.id AND t.number = r.num AND t.deleted_at IS NULL
        WHERE t.id <> r.issue_id AND EXISTS (SELECT 1 FROM inserted)
        ON CONFLICT DO NOTHING
      ),
      finished AS (
        UPDATE imports SET report = report || jsonb_build_object(
            'firstNumber', (SELECT min(number) FROM inserted),
            'lastNumber', (SELECT max(number) FROM inserted))
        WHERE id IN (SELECT id FROM claimed)
      )
      SELECT (SELECT count(*)::int FROM inserted) AS created,
        (SELECT min(number) FROM inserted) AS first_number,
        (SELECT max(number) FROM inserted) AS last_number
    `;
    return [claim, create];
  }

  /** Valid rows as the insert's recordset (CSV order: `ord` 1…N, top of the backlog). */
  function toRecords(
    values: ImportIssueValues[],
    statuses: z.infer<typeof statusRow>[],
    projectKeys: string[],
    ranks: string[],
  ) {
    return values.map((value, index) => {
      const description = value.description ? plainTextDoc(value.description) : null;
      return {
        ord: index + 1,
        id: crypto.randomUUID(),
        type: value.type,
        title: value.title,
        description,
        description_text: description ? extractPlainText(description) : "",
        status_id: value.statusId ?? defaultStatusId(statuses, value.type),
        priority: value.priority,
        assignee_id: value.assigneeId ?? null,
        use_default: value.assigneeId === undefined,
        story_points: value.storyPoints,
        due_date: value.dueDate,
        rank: ranks[index] ?? "",
        labels: value.labels,
        refs: value.description ? extractIssueRefs(value.description, projectKeys) : [],
      };
    });
  }

  return {
    /** Validates every row and records the preview (`imports` row, `previewed`). */
    async preview(actorId: string, input: PreviewImportData): Promise<ImportPreview> {
      const projectRef = sql`(SELECT id FROM projects WHERE key = ${input.projectKey}
        AND archived_at IS NULL)`;
      const [projectResult, found] = await allInOrder([
        read(db.execute(sql`SELECT ${projectRef}::text AS id`)),
        lookups(projectRef),
      ]);
      const [project] = rowsOf(projectResult, z.object({ id: z.string().nullable() }));
      if (!project?.id) throw notFound(`Project ${input.projectKey}`);
      const results = validateImportRows(input.fields, input.rows, found);
      const errors = results.flatMap((result) =>
        result.errors.map((error) => ({ row: result.row, ...error })),
      );
      const invalidCount = results.filter((result) => result.values === null).length;
      const report = previewReport(input.fields, importHash(input.fields, input.rows), errors);
      const [row] = rowsOf(
        await db.execute(sql`
          INSERT INTO imports (project_id, kind, filename, created_by, status, row_count,
            error_count, report)
          VALUES (${project.id}::uuid, 'issues_csv', ${input.filename}, ${actorId}::uuid,
            'previewed', ${input.rows.length}::int, ${invalidCount}::int,
            ${JSON.stringify(report)}::jsonb)
          RETURNING id::text
        `),
        z.object({ id: z.string() }),
      );
      if (!row) throw new Error("import insert returned nothing");
      return {
        importId: row.id,
        rowCount: input.rows.length,
        validCount: input.rows.length - invalidCount,
        invalidCount,
        errors,
      };
    },

    /**
     * Creates the valid rows of a previewed import, all or nothing. A second apply of the
     * same import (double submit, retry) creates nothing and reports the first one's keys.
     *
     * Two statements in one transaction: (1) claim the import and create missing labels;
     * (2) number and insert the issues. A rank collision with a concurrent create rolls the
     * whole transaction back (the import stays `previewed`) and is retried with fresh ranks.
     */
    async apply(actorId: string, input: ApplyImportData): Promise<ImportApplyResult> {
      const row = await loadImport(input.importId);
      if (row.status === "applied") return appliedResult(row);
      if (row.status !== "previewed") throw invalid("This import can no longer be applied");
      const report = reportSchema.safeParse(row.report);
      if (!report.success || report.data.hash !== importHash(input.fields, input.rows)) {
        throw invalid("The file or the column mapping changed since the preview; preview again");
      }
      const found = await lookups(row.project_id);
      const results = validateImportRows(input.fields, input.rows, found);
      const values = results.flatMap((result) => (result.values ? [result.values] : []));
      if (values.length === 0) throw invalid("No valid rows to import");
      const skipped = results.length - values.length;

      for (let attempt = 1; ; attempt += 1) {
        const ranks = generateNKeysBetween(null, await topRank(row.project_id), values.length);
        const records = toRecords(values, found.statuses, found.projectKeys, ranks);
        try {
          const outcome = await options.runAtomic(applyStatements(actorId, row, records, skipped));
          const [claim] = rowsOf(outcome[0], z.object({ claimed: z.number() }));
          if (!claim || claim.claimed === 0) {
            // Applied meanwhile (double submit), or a status or user went away.
            const latest = await loadImport(row.id);
            if (latest.status === "applied") return appliedResult(latest);
            throw conflict("The project changed since the preview; preview the file again");
          }
          const [created] = rowsOf(
            outcome[1],
            z.object({
              created: z.number(),
              first_number: z.number().nullable(),
              last_number: z.number().nullable(),
            }),
          );
          if (!created) throw new Error("import apply returned no row");
          return {
            created: created.created,
            skipped,
            alreadyApplied: false,
            firstKey:
              created.first_number === null
                ? null
                : formatIssueKey(row.project_key, created.first_number),
            lastKey:
              created.last_number === null
                ? null
                : formatIssueKey(row.project_key, created.last_number),
          };
        } catch (error) {
          const info = pgErrorInfo(error);
          const rankTaken =
            info?.code === UNIQUE_VIOLATION && info.constraint === "issues_project_rank_unique";
          if (!rankTaken) throw error;
          if (attempt >= RANK_ATTEMPTS) throw conflict("Too many concurrent creates; try again");
        }
      }
    },
  };
}

/** IMP-4 import history (the settings page's Import tab). */
export function createImportQueries(db: AppDatabase, { read = directRead }: QueryOptions = {}) {
  return {
    async listImports(projectId: IdRef, limit = 20): Promise<ImportHistoryItem[]> {
      const result = await read(
        db.execute(sql`
          SELECT i.id::text, i.filename, i.status::text AS status, i.row_count,
            i.created_count, i.error_count, u.name AS created_by_name,
            floor(extract(epoch FROM i.created_at) * 1000)::float8 AS created_ms,
            floor(extract(epoch FROM i.applied_at) * 1000)::float8 AS applied_ms
          FROM imports i LEFT JOIN users u ON u.id = i.created_by
          WHERE i.project_id = ${projectId}
          ORDER BY i.created_at DESC, i.id DESC
          LIMIT ${limit}
        `),
      );
      return rowsOf(result, historyRow).map((row) => ({
        id: row.id,
        filename: row.filename,
        status: row.status,
        rowCount: row.row_count,
        createdCount: row.created_count,
        errorCount: row.error_count,
        createdByName: row.created_by_name,
        createdAt: new Date(row.created_ms),
        appliedAt: row.applied_ms === null ? null : new Date(row.applied_ms),
      }));
    },
  };
}

export type ImportService = ReturnType<typeof createImportService>;
export type ImportQueries = ReturnType<typeof createImportQueries>;
