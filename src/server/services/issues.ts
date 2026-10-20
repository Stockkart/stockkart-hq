import { and, asc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import { type IssueType } from "@/lib/issues/constants";
import { formatIssueKey, parseIssueKey } from "@/lib/issues/keys";
import { toStoredLink, viewLink } from "@/lib/issues/links";
import {
  type addLabelInput,
  type addLinkInput,
  type createIssueInput,
  type updateIssueFieldInput,
} from "@/lib/issues/schemas";
import { extractPlainText, type RichTextDoc } from "@/lib/rich-text";
import { components, issues, projects, statuses, users } from "@/server/db/schema";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";

import { conflict, invalid, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";
import { parentProblem } from "./parent-rules";
import {
  docRefs,
  jsonbOrNull,
  mentionSyncCtes,
  mentionSyncStatement,
  rowsOf,
  uuidOrNull,
} from "./sql";

export type CreateIssueData = z.output<typeof createIssueInput>;
export type UpdateIssueFieldData = z.output<typeof updateIssueFieldInput>;
export type AddLabelData = z.output<typeof addLabelInput>;
export type AddLinkData = z.output<typeof addLinkInput>;

export interface CreatedIssue {
  id: string;
  number: number;
  key: string;
}

export interface FieldChange {
  /** Raw stored values as text (ids, numbers, ISO dates); null when unset or not recorded. */
  from: string | null;
  to: string | null;
  changed: boolean;
}

/** Number of attempts when two creators race for the same top-of-backlog rank. */
const RANK_ATTEMPTS = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface IssueServiceOptions {
  /** Transactions of several statements (see `RunAtomic`). */
  runAtomic: RunAtomic;
  /** Test hook: runs between reading the current top rank and the insert. */
  beforeInsert?: () => Promise<void>;
}

export function createIssueService(db: AppDatabase, options: IssueServiceOptions) {
  async function projectByKey(key: string) {
    const [project] = await db
      .select({ id: projects.id, key: projects.key })
      .from(projects)
      .where(and(eq(projects.key, key), isNull(projects.archivedAt)))
      .limit(1);
    if (!project) throw notFound(`Project ${key}`);
    return project;
  }

  async function liveIssue(issueId: string) {
    const [issue] = await db
      .select({
        id: issues.id,
        projectId: issues.projectId,
        number: issues.number,
        type: issues.type,
        projectKey: projects.key,
      })
      .from(issues)
      .innerJoin(projects, eq(projects.id, issues.projectId))
      .where(and(eq(issues.id, issueId), isNull(issues.deletedAt)))
      .limit(1);
    if (!issue) throw notFound("Issue");
    return issue;
  }

  async function allProjectKeys(): Promise<string[]> {
    const rows = await db.select({ key: projects.key }).from(projects);
    return rows.map((row) => row.key);
  }

  async function checkParentId(
    child: { id?: string; projectId: string; type: IssueType },
    parentId: string | null,
  ) {
    let parent = null;
    if (parentId) {
      const [row] = await db
        .select({
          id: issues.id,
          projectId: issues.projectId,
          type: issues.type,
          deletedAt: issues.deletedAt,
        })
        .from(issues)
        .where(eq(issues.id, parentId))
        .limit(1);
      if (!row) throw notFound("Parent issue");
      parent = row;
    }
    const problem = parentProblem(child, parent);
    if (problem) throw invalid(problem);
  }

  async function checkUser(userId: string | null) {
    if (!userId) return;
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw notFound("User");
  }

  async function checkComponent(projectId: string, componentId: string | null) {
    if (!componentId) return;
    const [row] = await db
      .select({ id: components.id })
      .from(components)
      .where(and(eq(components.id, componentId), eq(components.projectId, projectId)))
      .limit(1);
    if (!row) throw notFound("Component");
  }

  /** §4.4: Triage for bugs, Backlog for everything else; else the first status. */
  async function defaultStatusId(projectId: string, type: IssueType): Promise<string> {
    const wanted = type === "bug" ? "bug" : "other";
    const rows = await db
      .select({ id: statuses.id, isDefaultFor: statuses.isDefaultFor })
      .from(statuses)
      .where(eq(statuses.projectId, projectId))
      .orderBy(asc(statuses.position));
    const status = rows.find((row) => row.isDefaultFor === wanted) ?? rows[0];
    if (!status) throw invalid("The project has no statuses; run the seed first");
    return status.id;
  }

  async function topRank(projectId: string): Promise<string | null> {
    // Deleted issues keep their rank, and ranks are unique per project, so include them.
    const [row] = await db
      .select({ rank: issues.rank })
      .from(issues)
      .where(eq(issues.projectId, projectId))
      .orderBy(asc(issues.rank))
      .limit(1);
    return row?.rank ?? null;
  }

  return {
    /**
     * ISS-4. Allocates `STK-<n>` and inserts the issue in ONE statement:
     *
     *   UPDATE projects SET issue_counter = issue_counter + 1 … RETURNING issue_counter
     *   → INSERT INTO issues (number = that value) → INSERT INTO activity ('created')
     *
     * The UPDATE row-locks the project, so concurrent creators queue on it and each one
     * re-reads the committed counter (READ COMMITTED re-evaluates the locked row): numbers
     * are unique and gapless, and the unique (project_id, number) index backs that up. If
     * any part fails, the whole statement rolls back, the counter included.
     *
     * New issues go to the top of the backlog: rank = a key before the current first one.
     * Two creators reading the same top rank would produce the same key; the unique
     * (project_id, rank) index rejects the second, which retries with the new top.
     */
    async createIssue(actorId: string, input: CreateIssueData): Promise<CreatedIssue> {
      const project = await projectByKey(input.projectKey);
      const parentId = input.parentId ?? null;
      const assigneeId = input.assigneeId ?? null;
      const componentId = input.componentId ?? null;
      await Promise.all([
        checkParentId({ projectId: project.id, type: input.type }, parentId),
        checkUser(assigneeId),
        checkComponent(project.id, componentId),
      ]);
      const statusId = await defaultStatusId(project.id, input.type);
      const description = input.description ?? null;
      const descriptionText = description ? extractPlainText(description) : "";
      const refs = docRefs(description, await allProjectKeys());

      for (let attempt = 1; ; attempt += 1) {
        const id = crypto.randomUUID();
        const rank = generateKeyBetween(null, await topRank(project.id));
        await options.beforeInsert?.();
        try {
          const result = await db.execute(sql`
            WITH counter AS (
              UPDATE projects SET issue_counter = issue_counter + 1, updated_at = now()
              WHERE id = ${project.id}::uuid
              RETURNING issue_counter
            ),
            inserted AS (
              INSERT INTO issues (id, project_id, number, type, title, description,
                description_text, status_id, priority, assignee_id, reporter_id, parent_id,
                component_id, rank)
              SELECT ${id}::uuid, ${project.id}::uuid, counter.issue_counter,
                ${input.type}::issue_type, ${input.title}, ${jsonbOrNull(description)},
                ${descriptionText}, ${statusId}::uuid, ${input.priority}::smallint,
                ${uuidOrNull(assigneeId)}, ${actorId}::uuid, ${uuidOrNull(parentId)},
                ${uuidOrNull(componentId)}, ${rank}
              FROM counter
              RETURNING id, number
            ),
            created_activity AS (
              INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value)
              SELECT 'issue', inserted.id, ${actorId}::uuid, 'created', ${input.type}
              FROM inserted
            ),
            ${mentionSyncCtes({
              // Safe inline: the issue is new, so no other request can be syncing it.
              fromType: "issue",
              fromId: id,
              refs,
              actorId,
              gate: sql`EXISTS (SELECT 1 FROM inserted)`,
            })}
            SELECT id, number FROM inserted
          `);
          const [row] = rowsOf(result, z.object({ id: z.string(), number: z.number() }));
          if (!row) throw notFound(`Project ${input.projectKey}`);
          return { id: row.id, number: row.number, key: formatIssueKey(project.key, row.number) };
        } catch (error) {
          const info = pgErrorInfo(error);
          const rankTaken =
            info?.code === UNIQUE_VIOLATION && info.constraint === "issues_project_rank_unique";
          if (!rankTaken) throw error;
          if (attempt >= RANK_ATTEMPTS) throw conflict("Too many concurrent creates; try again");
          // Jitter so racing creators do not collide again on the next attempt.
          await sleep(Math.random() * 20 * attempt);
        }
      }
    },

    /**
     * Updates one field and records `activity` (from → to) in the same statement. The `old`
     * CTE row-locks the issue and reads the previous value; `changed` CTE writes and returns
     * both; the activity row is written only when the value really changed.
     *
     * A description change also resyncs its mention links, as a second statement in the same
     * transaction (see `mentionSyncCtes` for why it cannot be part of the first).
     */
    async updateIssueField(actorId: string, input: UpdateIssueFieldData): Promise<FieldChange> {
      const issue = await liveIssue(input.issueId);
      let column: string;
      let value: SQL;
      let alsoSet: SQL = sql``;
      let alsoWhere: SQL = sql``;
      let recordValues = true;
      let mentionSync: SQL | null = null;

      switch (input.field) {
        case "title":
          column = "title";
          value = sql`${input.value}::text`;
          break;
        case "description": {
          column = "description";
          const doc: RichTextDoc | null = input.value;
          value = jsonbOrNull(doc);
          alsoSet = sql`description_text = ${doc ? extractPlainText(doc) : ""},`;
          // Descriptions are large; activity records only that it changed.
          recordValues = false;
          mentionSync = mentionSyncStatement({
            fromType: "issue",
            fromId: issue.id,
            refs: docRefs(doc, await allProjectKeys()),
            actorId,
            gate: sql`EXISTS (SELECT 1 FROM issues WHERE id = ${issue.id}::uuid AND deleted_at IS NULL)`,
          });
          break;
        }
        case "status": {
          const [status] = await db
            .select({ id: statuses.id })
            .from(statuses)
            .where(and(eq(statuses.id, input.value), eq(statuses.projectId, issue.projectId)))
            .limit(1);
          if (!status) throw notFound("Status");
          column = "status_id";
          value = sql`${input.value}::uuid`;
          // §4.4: entering a done-category status sets resolved_at (kept when moving
          // between done statuses, e.g. Done → Won't Do); leaving done clears it.
          alsoSet = sql`resolved_at = CASE
              WHEN (SELECT category FROM statuses WHERE id = ${input.value}::uuid) = 'done'
                THEN COALESCE(issues.resolved_at, now())
              ELSE NULL
            END,`;
          break;
        }
        case "priority":
          column = "priority";
          value = sql`${input.value}::smallint`;
          break;
        case "assignee":
          await checkUser(input.value);
          column = "assignee_id";
          value = uuidOrNull(input.value);
          break;
        case "component":
          await checkComponent(issue.projectId, input.value);
          column = "component_id";
          value = uuidOrNull(input.value);
          break;
        case "storyPoints":
          column = "story_points";
          value = sql`${input.value}::int`;
          break;
        case "dueDate":
          column = "due_date";
          value = sql`${input.value}::date`;
          break;
        case "parent":
          await checkParentId(issue, input.value);
          column = "parent_id";
          value = uuidOrNull(input.value);
          // Re-checked at write time: the parent may have been deleted since the check.
          if (input.value) {
            alsoWhere = sql`AND EXISTS (
              SELECT 1 FROM issues p WHERE p.id = ${input.value}::uuid AND p.deleted_at IS NULL
            )`;
          }
          break;
      }

      const col = sql.identifier(column);
      const write = sql`
        WITH old AS (
          SELECT id, ${col}::text AS v FROM issues
          WHERE id = ${issue.id}::uuid AND deleted_at IS NULL
          FOR UPDATE
        ),
        changed AS (
          UPDATE issues SET ${col} = ${value}, ${alsoSet} updated_at = now()
          FROM old WHERE issues.id = old.id ${alsoWhere}
          RETURNING issues.id, old.v AS from_value, issues.${col}::text AS to_value
        ),
        field_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value)
          SELECT 'issue', id, ${actorId}::uuid, 'updated', ${input.field},
            CASE WHEN ${recordValues}::boolean THEN from_value END,
            CASE WHEN ${recordValues}::boolean THEN to_value END
          FROM changed
          WHERE from_value IS DISTINCT FROM to_value
        )
        SELECT from_value, to_value FROM changed
      `;
      const [result] = mentionSync
        ? await options.runAtomic([write, mentionSync])
        : [await db.execute(write)];
      const [row] = rowsOf(
        result,
        z.object({ from_value: z.string().nullable(), to_value: z.string().nullable() }),
      );
      // No row: the issue was deleted meanwhile, or (parent) the new parent was.
      if (!row) throw notFound(input.field === "parent" ? "Issue or parent issue" : "Issue");
      return {
        from: recordValues ? row.from_value : null,
        to: recordValues ? row.to_value : null,
        changed: row.from_value !== row.to_value,
      };
    },

    /** Adds a label by name, creating it in the project if needed. Idempotent. */
    async addLabel(actorId: string, input: AddLabelData): Promise<{ labelId: string }> {
      const issue = await liveIssue(input.issueId);
      // Two tries: if another request creates the same label between our snapshot and our
      // insert, the first statement sees neither row; the retry sees the committed one.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await db.execute(sql`
          WITH created_label AS (
            INSERT INTO labels (project_id, name) VALUES (${issue.projectId}::uuid, ${input.name})
            ON CONFLICT (project_id, name) DO NOTHING
            RETURNING id
          ),
          label AS (
            SELECT id FROM created_label
            UNION ALL
            SELECT id FROM labels WHERE project_id = ${issue.projectId}::uuid AND name = ${input.name}
            LIMIT 1
          ),
          attached AS (
            INSERT INTO issue_labels (issue_id, label_id)
            SELECT ${issue.id}::uuid, id FROM label
            ON CONFLICT DO NOTHING
            RETURNING label_id
          ),
          label_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value, meta)
            SELECT 'issue', ${issue.id}::uuid, ${actorId}::uuid, 'label_added', 'labels',
              label_id::text, jsonb_build_object('name', ${input.name}::text)
            FROM attached
          )
          SELECT id::text AS label_id FROM label
        `);
        const [row] = rowsOf(result, z.object({ label_id: z.string() }));
        if (row) return { labelId: row.label_id };
      }
      throw conflict("Could not add the label; try again");
    },

    async removeLabel(actorId: string, input: { issueId: string; labelId: string }) {
      const issue = await liveIssue(input.issueId);
      await db.execute(sql`
        WITH detached AS (
          DELETE FROM issue_labels
          WHERE issue_id = ${issue.id}::uuid AND label_id = ${input.labelId}::uuid
          RETURNING label_id
        )
        INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value, meta)
        SELECT 'issue', ${issue.id}::uuid, ${actorId}::uuid, 'label_removed', 'labels',
          d.label_id::text, jsonb_build_object('name', l.name)
        FROM detached d JOIN labels l ON l.id = d.label_id
      `);
    },

    /**
     * ISS-6. Stores the link in its active direction and logs it on both issues, each from
     * its own viewpoint ("blocks" on one, "is blocked by" on the other).
     */
    async addLink(actorId: string, input: AddLinkData): Promise<{ linkId: string }> {
      const issue = await liveIssue(input.issueId);
      const ref = parseIssueKey(input.targetKey);
      if (!ref) throw invalid("Enter an issue key such as STK-12");
      const [target] = await db
        .select({ id: issues.id })
        .from(issues)
        .innerJoin(projects, eq(projects.id, issues.projectId))
        .where(
          and(
            eq(projects.key, ref.projectKey),
            eq(issues.number, ref.number),
            isNull(issues.deletedAt),
          ),
        )
        .limit(1);
      if (!target) throw notFound(formatIssueKey(ref.projectKey, ref.number));
      if (target.id === issue.id) throw invalid("An issue cannot link to itself");

      const stored = toStoredLink(input.relation, issue.id, target.id);
      const sourceView = viewLink(stored, stored.sourceIssueId).relation;
      const targetView = viewLink(stored, stored.targetIssueId).relation;
      // `issue_links_pair_unique` (type, unordered pair) rejects the same link in either
      // direction, so concurrent requests cannot both add "A relates B" / "B relates A" or
      // the contradictory "A blocks B" / "B blocks A".
      const result = await db.execute(sql`
        WITH link AS (
          INSERT INTO issue_links (source_issue_id, target_issue_id, type, created_by)
          VALUES (${stored.sourceIssueId}::uuid, ${stored.targetIssueId}::uuid,
            ${stored.type}::issue_link_type, ${actorId}::uuid)
          ON CONFLICT DO NOTHING
          RETURNING id
        ),
        link_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value, meta)
          SELECT 'issue', v.issue_id, ${actorId}::uuid, 'link_added', 'links', v.other_id,
            jsonb_build_object('relation', v.relation)
          FROM link, (VALUES
            (${stored.sourceIssueId}::uuid, ${stored.targetIssueId}::text, ${sourceView}::text),
            (${stored.targetIssueId}::uuid, ${stored.sourceIssueId}::text, ${targetView}::text)
          ) AS v(issue_id, other_id, relation)
        )
        SELECT id::text AS link_id FROM link
      `);
      const [row] = rowsOf(result, z.object({ link_id: z.string() }));
      if (!row) throw conflict("These issues are already linked that way (in one direction)");
      return { linkId: row.link_id };
    },

    async removeLink(actorId: string, input: { issueId: string; linkId: string }) {
      const issue = await liveIssue(input.issueId);
      const result = await db.execute(sql`
        WITH removed AS (
          DELETE FROM issue_links
          WHERE id = ${input.linkId}::uuid
            AND (source_issue_id = ${issue.id}::uuid OR target_issue_id = ${issue.id}::uuid)
          RETURNING source_issue_id, target_issue_id, type
        ),
        link_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value, meta)
          SELECT 'issue', v.issue_id, ${actorId}::uuid, 'link_removed', 'links', v.other_id,
            jsonb_build_object('relation', v.relation)
          FROM removed r, LATERAL (VALUES
            (r.source_issue_id, r.target_issue_id::text, CASE r.type
              WHEN 'blocks' THEN 'blocks' WHEN 'duplicates' THEN 'duplicates' ELSE 'relates' END),
            (r.target_issue_id, r.source_issue_id::text, CASE r.type
              WHEN 'blocks' THEN 'is_blocked_by' WHEN 'duplicates' THEN 'is_duplicated_by'
              ELSE 'relates' END)
          ) AS v(issue_id, other_id, relation)
        )
        SELECT count(*)::int AS removed FROM removed
      `);
      const [row] = rowsOf(result, z.object({ removed: z.number() }));
      if (!row || row.removed === 0) throw notFound("Link");
    },

    /** Soft delete (ISS-13 restore comes later). Children and links are kept. */
    async deleteIssue(actorId: string, issueId: string): Promise<void> {
      const result = await db.execute(sql`
        WITH deleted AS (
          UPDATE issues SET deleted_at = now(), updated_at = now()
          WHERE id = ${issueId}::uuid AND deleted_at IS NULL
          RETURNING id
        ),
        delete_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action)
          SELECT 'issue', id, ${actorId}::uuid, 'deleted' FROM deleted
        )
        SELECT count(*)::int AS deleted FROM deleted
      `);
      const [row] = rowsOf(result, z.object({ deleted: z.number() }));
      if (!row || row.deleted === 0) throw notFound("Issue");
    },
  };
}

export type IssueService = ReturnType<typeof createIssueService>;
