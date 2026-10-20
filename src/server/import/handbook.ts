import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { and, eq, isNull, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import { canonicalJson } from "@/lib/canonical-json";
import { adrTitle, parseAdrStatus, splitAdrTitle } from "@/lib/docs/adr";
import { type AdrStatus, type DocType } from "@/lib/docs/constants";
import { markdownToRichText, sectionText, takeTitle } from "@/lib/markdown/to-rich-text";
import { extractPlainText, type RichTextDoc, richTextDocSchema, rt } from "@/lib/rich-text";
import { projects } from "@/server/db/schema";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";
import { pgErrorInfo, UNIQUE_VIOLATION } from "@/server/services/errors";
import {
  docRefs,
  jsonbOrNull,
  mentionSyncCtes,
  mentionSyncStatement,
  rowsOf,
  uuidOrNull,
} from "@/server/services/sql";

/**
 * IMP-1/2/3 handbook import: `engineering-handbook/*.md` become docs and
 * `decisions/NNNN-*.md` become ADRs, grouped under the pages "Handbook" and "Decisions".
 *
 * Runs locally (scripts/import-handbook.ts) against DATABASE_URL. The imported content lives
 * only in the database, never in this repo (S-7): tests use small synthetic markdown.
 *
 * Re-runnable: every doc is keyed by `docs.source_path` (unique per project). A re-run
 * updates docs whose file changed in place (version + 1 and a snapshot, so open editors get
 * the conflict banner rather than silently losing the import), leaves unchanged ones alone,
 * never moves a doc someone re-parented in HQ, and skips docs edited in HQ since the import
 * (HQ is the source of truth) unless `force` is set. Imported writes have no actor (null).
 */

/** Source paths of the two group pages (directories, so they never clash with files). */
export const HANDBOOK_ROOT = ".";
export const DECISIONS_DIR = "decisions";

/** IMP-1 type per top-level file; anything else is a plain page. */
const TOP_LEVEL_TYPES: Record<string, DocType> = {
  README: "page",
  ARCHITECTURE: "design",
  API_CONTRACT: "api_contract",
  RUNBOOK: "runbook",
  // A review rubric is a checklist; the closest doc type is a page.
  REVIEW_RUBRIC: "page",
  IN_MEMORY_STATE: "design",
};
/** Tree order under "Handbook": the known files first, then the rest alphabetically. */
const TOP_LEVEL_ORDER = Object.keys(TOP_LEVEL_TYPES);

const ADR_FILE = /^(\d{4})-[^/]+\.md$/;

export interface HandbookFile {
  /** Relative to the handbook directory, with `/` separators: `decisions/0004-ocr.md`. */
  path: string;
  markdown: string;
}

export type PlannedDoc =
  | { kind: "group"; sourcePath: string; title: string; parentPath: string | null }
  | {
      kind: "doc";
      sourcePath: string;
      title: string;
      type: DocType;
      content: RichTextDoc;
      parentPath: string;
    }
  | {
      kind: "adr";
      sourcePath: string;
      title: string;
      number: number;
      status: AdrStatus;
      supersededByNumber: number | null;
      content: RichTextDoc;
      parentPath: string;
    };

export interface ImportPlan {
  docs: PlannedDoc[];
  skipped: { path: string; reason: string }[];
  warnings: string[];
}

function baseName(file: string): string {
  return path.posix.basename(file, ".md");
}

function parseContent(file: HandbookFile, warnings: string[]) {
  const { title, doc } = takeTitle(markdownToRichText(file.markdown));
  const parsed = richTextDocSchema.safeParse(doc);
  if (!parsed.success) return null;
  if (!title) warnings.push(`${file.path}: no "# Title" line; using the file name`);
  return { title, content: parsed.data };
}

/** Pure: what the import would create, from the file list. */
export function planHandbookImport(files: readonly HandbookFile[]): ImportPlan {
  const plan: ImportPlan = { docs: [], skipped: [], warnings: [] };
  const topLevel: PlannedDoc[] = [];
  const adrs: (PlannedDoc & { kind: "adr" })[] = [];

  for (const file of files) {
    const parts = file.path.split("/");
    if (parts.length === 1 && file.path.endsWith(".md")) {
      const parsed = parseContent(file, plan.warnings);
      if (!parsed) {
        plan.skipped.push({ path: file.path, reason: "too large or too deeply nested" });
        continue;
      }
      const name = baseName(file.path);
      topLevel.push({
        kind: "doc",
        sourcePath: file.path,
        title: parsed.title ?? name,
        type: TOP_LEVEL_TYPES[name] ?? "page",
        content: parsed.content,
        parentPath: HANDBOOK_ROOT,
      });
      continue;
    }
    const fileName = parts[1] ?? "";
    const match = parts.length === 2 && parts[0] === DECISIONS_DIR ? ADR_FILE.exec(fileName) : null;
    if (!match?.[1]) {
      plan.skipped.push({
        path: file.path,
        reason: "not a top-level doc or a decisions/NNNN-*.md ADR",
      });
      continue;
    }
    const number = Number(match[1]);
    if (number === 0) {
      plan.skipped.push({ path: file.path, reason: "ADR template" });
      continue;
    }
    const parsed = parseContent(file, plan.warnings);
    if (!parsed) {
      plan.skipped.push({ path: file.path, reason: "too large or too deeply nested" });
      continue;
    }
    const heading = parsed.title ? splitAdrTitle(parsed.title) : null;
    if (heading && heading.number !== number) {
      plan.warnings.push(
        `${file.path}: heading says ${heading.number}, file name ${number}; using ${number}`,
      );
    }
    const name =
      heading?.title || parsed.title || fileName.replace(ADR_FILE, "").replace(/-/g, " ");
    const statusText = sectionText(parsed.content, "Status");
    const status = statusText === null ? null : parseAdrStatus(statusText);
    if (!status) {
      plan.warnings.push(`${file.path}: no recognised "## Status"; importing as Proposed`);
    }
    adrs.push({
      kind: "adr",
      sourcePath: file.path,
      title: adrTitle(number, name || fileName),
      number,
      status: status?.status ?? "proposed",
      supersededByNumber: status?.supersededBy ?? null,
      content: parsed.content,
      parentPath: DECISIONS_DIR,
    });
  }

  const rank = (doc: PlannedDoc) => {
    const index = TOP_LEVEL_ORDER.indexOf(baseName(doc.sourcePath));
    return index < 0 ? TOP_LEVEL_ORDER.length : index;
  };
  topLevel.sort((a, b) => rank(a) - rank(b) || a.sourcePath.localeCompare(b.sourcePath));
  adrs.sort((a, b) => a.number - b.number);

  if (topLevel.length > 0 || adrs.length > 0) {
    plan.docs.push({
      kind: "group",
      sourcePath: HANDBOOK_ROOT,
      title: "Handbook",
      parentPath: null,
    });
  }
  plan.docs.push(...topLevel);
  if (adrs.length > 0) {
    plan.docs.push({
      kind: "group",
      sourcePath: DECISIONS_DIR,
      title: "Decisions",
      parentPath: HANDBOOK_ROOT,
    });
    plan.docs.push(...adrs);
  }
  return plan;
}

/** Top-level `*.md` and `decisions/*.md` of a handbook checkout. */
export async function readHandbookDir(dir: string): Promise<HandbookFile[]> {
  const files: HandbookFile[] = [];
  const read = async (relative: string) => {
    files.push({ path: relative, markdown: await readFile(path.join(dir, relative), "utf8") });
  };
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) await read(entry.name);
  }
  const decisions = path.join(dir, DECISIONS_DIR);
  const entries = await readdir(decisions, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) await read(`${DECISIONS_DIR}/${entry.name}`);
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export type ImportAction = "create" | "update" | "unchanged" | "skip";

export interface ImportResult {
  sourcePath: string;
  title: string;
  action: ImportAction;
  reason?: string;
  adrNumber?: number;
}

export interface ImportSummary {
  dryRun: boolean;
  results: ImportResult[];
  skippedFiles: { path: string; reason: string }[];
  warnings: string[];
  counts: Record<ImportAction, number>;
  adrNumbers: number[];
}

/** JSON with object keys sorted, so jsonb (which reorders keys) compares equal. */
const canonical = canonicalJson;

const existingRow = z.object({
  id: z.string(),
  source_path: z.string(),
  title: z.string(),
  content: z.unknown(),
  version: z.number(),
  adr_number: z.number().nullable(),
  adr_status: z.string().nullable(),
  deleted: z.boolean(),
  /** Imports write `updated_by = NULL`; every edit in HQ sets it. */
  edited_in_hq: z.boolean(),
});

export interface ImportOptions {
  projectKey: string;
  dryRun: boolean;
  runAtomic: RunAtomic;
  /**
   * Overwrite docs that were edited in HQ since they were imported. Off by default: HQ is
   * the source of truth after the import (SPEC decisions, DOC-12).
   */
  force?: boolean;
}

/**
 * Applies a plan. Group pages are created first so docs can be placed under them; ADR
 * "Superseded by NNNN" links are resolved in a second pass, once every ADR exists.
 */
export async function importHandbook(
  db: AppDatabase,
  plan: ImportPlan,
  options: ImportOptions,
): Promise<ImportSummary> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.key, options.projectKey), isNull(projects.archivedAt)))
    .limit(1);
  if (!project) throw new Error(`Project ${options.projectKey} not found (run the seed first)`);
  const projectId = project.id;
  const projectKeys = (await db.select({ key: projects.key }).from(projects)).map((row) => row.key);

  const paths = plan.docs.map((doc) => doc.sourcePath);
  const existing = new Map(
    rowsOf(
      await db.execute(sql`
        SELECT id::text, source_path, title, content, version, adr_number, adr_status::text,
          deleted_at IS NOT NULL AS deleted, updated_by IS NOT NULL AS edited_in_hq
        FROM docs
        WHERE project_id = ${project.id}::uuid AND source_path IN (
          SELECT jsonb_array_elements_text(${JSON.stringify(paths)}::jsonb)
        )
      `),
      existingRow,
    ).map((row) => [row.source_path, row]),
  );

  const results: ImportResult[] = [];
  const idByPath = new Map<string, string>();
  const warnings = [...plan.warnings];

  async function endPosition(parentId: string | null): Promise<string> {
    const [last] = rowsOf(
      await db.execute(sql`
        SELECT position FROM docs
        WHERE project_id = ${projectId}::uuid AND parent_id IS NOT DISTINCT FROM ${uuidOrNull(parentId)}
          AND deleted_at IS NULL
        ORDER BY position DESC, id DESC LIMIT 1
      `),
      z.object({ position: z.string() }),
    );
    return generateKeyBetween(last?.position ?? null, null);
  }

  for (const planned of plan.docs) {
    const current = existing.get(planned.sourcePath);
    const adrNumber = planned.kind === "adr" ? planned.number : undefined;
    const record = (action: ImportAction, reason?: string) =>
      results.push({
        sourcePath: planned.sourcePath,
        title: planned.title,
        action,
        reason,
        adrNumber,
      });

    if (current?.deleted) {
      record("skip", "deleted in HQ");
      continue;
    }
    if (current) idByPath.set(planned.sourcePath, current.id);

    if (planned.kind === "group") {
      if (current) {
        record("unchanged");
        continue;
      }
      if (options.dryRun) {
        record("create");
        continue;
      }
      const parentId = planned.parentPath ? (idByPath.get(planned.parentPath) ?? null) : null;
      const id = await insertDoc(db, {
        projectId: project.id,
        parentId,
        position: await endPosition(parentId),
        title: planned.title,
        type: "page",
        content: rt.doc(rt.paragraph("Imported from the engineering handbook.")),
        sourcePath: planned.sourcePath,
        projectKeys,
      });
      idByPath.set(planned.sourcePath, id);
      record("create");
      continue;
    }

    const status = planned.kind === "adr" ? planned.status : null;
    if (current) {
      const same =
        current.title === planned.title &&
        canonical(current.content) === canonical(planned.content) &&
        current.adr_number === (adrNumber ?? null) &&
        current.adr_status === status;
      if (same) {
        record("unchanged");
        continue;
      }
      // Someone changed it in HQ since the import: HQ wins unless --force.
      if (current.edited_in_hq && !options.force) {
        record("skip", "edited in HQ (re-run with --force to overwrite)");
        continue;
      }
      if (!options.dryRun) {
        try {
          const written = await updateDoc(db, options.runAtomic, {
            id: current.id,
            expectedVersion: current.version,
            force: options.force ?? false,
            title: planned.title,
            content: planned.content,
            adrNumber: adrNumber ?? null,
            adrStatus: status,
            projectKeys,
          });
          if (!written) {
            record("skip", "changed in HQ during the import");
            continue;
          }
        } catch (error) {
          const clash = describeAdrClash(error, planned.sourcePath, adrNumber);
          if (!(clash instanceof AdrClashError)) throw error;
          record("skip", clash.message);
          continue;
        }
      }
      record("update");
      continue;
    }

    if (options.dryRun) {
      record("create");
      continue;
    }
    const parentId = idByPath.get(planned.parentPath) ?? null;
    try {
      const id = await insertDoc(db, {
        projectId: project.id,
        parentId,
        position: await endPosition(parentId),
        title: planned.title,
        type: planned.kind === "adr" ? "adr" : planned.type,
        content: planned.content,
        sourcePath: planned.sourcePath,
        adrNumber,
        adrStatus: status ?? undefined,
        projectKeys,
      });
      idByPath.set(planned.sourcePath, id);
      record("create");
    } catch (error) {
      const clash = describeAdrClash(error, planned.sourcePath, adrNumber);
      if (clash instanceof AdrClashError) {
        record("skip", clash.message);
        continue;
      }
      throw error;
    }
  }

  // Second pass: "Superseded by NNNN" → adr_superseded_by, now that every ADR exists. Only
  // for ADRs written by this run, so a supersede set in HQ on an untouched ADR stays.
  if (!options.dryRun) {
    const written = new Set(
      results
        .filter((result) => result.action === "create" || result.action === "update")
        .map((result) => result.sourcePath),
    );
    for (const planned of plan.docs) {
      if (planned.kind !== "adr") continue;
      const id = idByPath.get(planned.sourcePath);
      if (!id || !written.has(planned.sourcePath)) continue;
      const target = planned.supersededByNumber;
      const [row] = rowsOf(
        await db.execute(sql`
          UPDATE docs SET adr_superseded_by = (
            SELECT t.id FROM docs t
            WHERE t.project_id = docs.project_id AND t.adr_number = ${target}::int
              AND t.type = 'adr' AND t.deleted_at IS NULL AND t.id <> docs.id
          )
          WHERE id = ${id}::uuid
          RETURNING adr_superseded_by::text AS target
        `),
        z.object({ target: z.string().nullable() }),
      );
      if (target !== null && !row?.target) {
        warnings.push(`${planned.sourcePath}: superseding ADR ${target} not found`);
      }
    }
  }

  const counts: Record<ImportAction, number> = { create: 0, update: 0, unchanged: 0, skip: 0 };
  for (const result of results) counts[result.action] += 1;
  counts.skip += plan.skipped.length;
  return {
    dryRun: options.dryRun,
    results,
    skippedFiles: plan.skipped,
    warnings,
    counts,
    adrNumbers: results
      .filter((result) => result.action !== "skip" && result.adrNumber !== undefined)
      .map((result) => result.adrNumber ?? 0),
  };
}

class AdrClashError extends Error {}

/** A unique violation on the ADR number: an HQ-made ADR already holds that number. */
function describeAdrClash(
  error: unknown,
  sourcePath: string,
  adrNumber: number | undefined,
): unknown {
  const info = pgErrorInfo(error);
  if (
    adrNumber !== undefined &&
    info?.code === UNIQUE_VIOLATION &&
    info.constraint === "docs_project_adr_number_unique"
  ) {
    return new AdrClashError(`ADR ${adrNumber} already exists in HQ (${sourcePath} not imported)`);
  }
  return error;
}

async function insertDoc(
  db: AppDatabase,
  values: {
    projectId: string;
    parentId: string | null;
    position: string;
    title: string;
    type: DocType;
    content: RichTextDoc;
    sourcePath: string;
    adrNumber?: number;
    adrStatus?: AdrStatus;
    projectKeys: string[];
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const result = await db.execute(sql`
    WITH inserted AS (
      INSERT INTO docs (id, project_id, parent_id, type, title, content, content_text, position,
        adr_number, adr_status, source_path)
      VALUES (${id}::uuid, ${values.projectId}::uuid, ${uuidOrNull(values.parentId)},
        ${values.type}::doc_type, ${values.title}, ${jsonbOrNull(values.content)},
        ${extractPlainText(values.content)}, ${values.position}, ${values.adrNumber ?? null}::int,
        ${values.adrStatus ?? null}::adr_status, ${values.sourcePath})
      RETURNING id, version, title, content
    ),
    first_version AS (
      INSERT INTO doc_versions (doc_id, version, title, content, author_id)
      SELECT id, version, title, content, NULL FROM inserted
    ),
    ${mentionSyncCtes({
      // Safe inline: the doc is new, so nobody else can be syncing it.
      fromType: "doc",
      fromId: id,
      refs: docRefs(values.content, values.projectKeys),
      actorId: null,
      gate: sql`EXISTS (SELECT 1 FROM inserted)`,
    })}
    SELECT id::text FROM inserted
  `);
  const [row] = rowsOf(result, z.object({ id: z.string() }));
  if (!row) throw new Error(`insert of ${values.sourcePath} returned nothing`);
  return row.id;
}

/**
 * Re-import: new content as a new version with a snapshot, then resync its mentions. Locked
 * like an editor save (§7.4): it applies only if the doc is still at the version read at the
 * start, and (without force) still unedited in HQ. Returns false if it did not apply.
 */
async function updateDoc(
  db: AppDatabase,
  runAtomic: RunAtomic,
  values: {
    id: string;
    expectedVersion: number;
    force: boolean;
    title: string;
    content: RichTextDoc;
    adrNumber: number | null;
    adrStatus: AdrStatus | null;
    projectKeys: string[];
  },
): Promise<boolean> {
  const [result] = await runAtomic([
    sql`
      WITH updated AS (
        UPDATE docs SET title = ${values.title}, content = ${jsonbOrNull(values.content)},
          content_text = ${extractPlainText(values.content)}, adr_number = ${values.adrNumber}::int,
          adr_status = ${values.adrStatus}::adr_status, version = version + 1,
          updated_by = NULL, updated_at = now()
        WHERE id = ${values.id}::uuid AND deleted_at IS NULL
          AND version = ${values.expectedVersion}::int
          AND (${values.force}::boolean OR updated_by IS NULL)
        RETURNING id, version, title, content
      ),
      snapshot AS (
        INSERT INTO doc_versions (doc_id, version, title, content, author_id)
        SELECT id, version, title, content, NULL FROM updated
      )
      SELECT id::text FROM updated
    `,
    mentionSyncStatement({
      fromType: "doc",
      fromId: values.id,
      refs: docRefs(values.content, values.projectKeys),
      actorId: null,
      // Same rule as saveDoc: only if this transaction wrote the doc.
      gate: sql`EXISTS (SELECT 1 FROM docs WHERE id = ${values.id}::uuid
        AND xmin = pg_current_xact_id()::xid)`,
    }),
  ]);
  return rowsOf(result, z.object({ id: z.string() })).length > 0;
}
