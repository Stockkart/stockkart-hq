import { and, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { BULK_MAX, type bulkEditInput, type BulkEditResult } from "@/lib/issues/bulk";
import { formatIssueKey } from "@/lib/issues/keys";
import { directRead, type Read } from "@/server/db/read-batch";
import { issues, labels, projects, sprints, statuses, users } from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

import { conflict, invalid, notFound } from "./errors";
import { type Notify } from "./notifications";
import { allInOrder } from "./parallel";
import { rowsOf, uuidOrNull } from "./sql";

export type BulkEditData = z.output<typeof bulkEditInput>;

const resultRow = z.object({
  ok: z.boolean(),
  found: z.number(),
  changed: z.number(),
  events: z.array(
    z.object({
      activityId: z.string(),
      issueId: z.string(),
      number: z.number(),
      to: z.string().nullable(),
      watchers: z.array(z.string()).nullable(),
    }),
  ),
});

/** A jsonb array of uuids as rows (`value`), for `IN (…)` lists of any length. */
const uuidList = (ids: readonly string[]) =>
  sql`(SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;

/**
 * ISS-12 bulk edit: one change applied to up to `BULK_MAX` issues of one project in ONE
 * statement, so it is all or nothing:
 *
 *   target   row-locks every selected live issue of the project (`FOR UPDATE`; the
 *            values read are the latest committed ones, as in `updateIssueField`)
 *   gate     true only if ALL ids were found there (an id of another project, a deleted
 *            or unknown issue refuses the whole batch) and the change's target still
 *            exists (status of the project, open sprint, the project's labels)
 *   changed  the write, only where the value really changes
 *   activity one row per issue and field, from → to (labels: one row per label), so the
 *            history and the burndown replay (SPR-3: status, sprint) see every change
 *
 * The same checks run first as batched reads, for precise error messages; the gate makes
 * them hold at write time.
 */
export function createBulkService(db: AppDatabase, options: { read?: Read; notify?: Notify } = {}) {
  const read = options.read ?? directRead;

  async function projectByKey(key: string) {
    const [row] = await read(
      db
        .select({ id: projects.id, key: projects.key })
        .from(projects)
        .where(and(eq(projects.key, key), isNull(projects.archivedAt)))
        .limit(1),
    );
    if (!row) throw notFound(`Project ${key}`);
    return row;
  }

  async function liveCount(projectKey: string, ids: string[]) {
    const [row] = await read(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(issues)
        .innerJoin(projects, eq(projects.id, issues.projectId))
        .where(
          and(eq(projects.key, projectKey), inArray(issues.id, ids), isNull(issues.deletedAt)),
        ),
    );
    return row?.n ?? 0;
  }

  /** The change's own check (as a read batched with the others). */
  async function checkTarget(projectKey: string, change: BulkEditData["change"]) {
    const inProject = sql`(SELECT id FROM projects WHERE key = ${projectKey})`;
    switch (change.kind) {
      case "status": {
        const [row] = await read(
          db
            .select({ id: statuses.id })
            .from(statuses)
            .where(and(eq(statuses.id, change.statusId), eq(statuses.projectId, inProject)))
            .limit(1),
        );
        if (!row) throw notFound("Status");
        return;
      }
      case "assignee": {
        if (!change.assigneeId) return;
        const [row] = await read(
          db.select({ id: users.id }).from(users).where(eq(users.id, change.assigneeId)).limit(1),
        );
        if (!row) throw notFound("User");
        return;
      }
      case "sprint": {
        if (!change.sprintId) return;
        const [row] = await read(
          db
            .select({ state: sprints.state })
            .from(sprints)
            .where(and(eq(sprints.id, change.sprintId), eq(sprints.projectId, inProject)))
            .limit(1),
        );
        if (!row) throw notFound("Sprint");
        if (row.state === "closed") throw invalid("That sprint is closed; pick an open one");
        return;
      }
      case "addLabels":
      case "removeLabels": {
        const rows = await read(
          db
            .select({ id: labels.id })
            .from(labels)
            .where(and(inArray(labels.id, change.labelIds), eq(labels.projectId, inProject))),
        );
        if (rows.length !== change.labelIds.length) throw notFound("Label");
        return;
      }
      default:
        return;
    }
  }

  /** The statement for one field change of `issues` (status, priority, assignee, sprint). */
  function fieldWrite(
    change: Extract<
      BulkEditData["change"],
      { kind: "status" | "priority" | "assignee" | "sprint" }
    >,
  ): { column: string; field: string; value: SQL; alsoSet: SQL; gate: SQL; watch: boolean } {
    switch (change.kind) {
      case "status":
        return {
          column: "status_id",
          field: "status",
          value: sql`${change.statusId}::uuid`,
          // §4.4, as in updateIssueField: entering done sets resolved_at, leaving clears it.
          alsoSet: sql`resolved_at = CASE
              WHEN (SELECT category FROM statuses WHERE id = ${change.statusId}::uuid) = 'done'
                THEN COALESCE(issues.resolved_at, now())
              ELSE NULL
            END,`,
          gate: sql`EXISTS (SELECT 1 FROM statuses s WHERE s.id = ${change.statusId}::uuid
            AND s.project_id = (SELECT id FROM project))`,
          watch: false,
        };
      case "priority":
        return {
          column: "priority",
          field: "priority",
          value: sql`${change.priority}::smallint`,
          alsoSet: sql``,
          gate: sql`TRUE`,
          watch: false,
        };
      case "assignee":
        return {
          column: "assignee_id",
          field: "assignee",
          value: uuidOrNull(change.assigneeId),
          alsoSet: sql``,
          gate: change.assigneeId
            ? sql`EXISTS (SELECT 1 FROM users u WHERE u.id = ${change.assigneeId}::uuid)`
            : sql`TRUE`,
          // ISS-11: the assignee watches the issue.
          watch: change.assigneeId !== null,
        };
      case "sprint":
        return {
          column: "sprint_id",
          field: "sprint",
          value: uuidOrNull(change.sprintId),
          alsoSet: sql``,
          // BLG-3: an open sprint of the project, share-locked against a concurrent start
          // or completion (as in updateIssueField).
          gate: change.sprintId
            ? sql`EXISTS (SELECT 1 FROM sprints s WHERE s.id = ${change.sprintId}::uuid
                AND s.project_id = (SELECT id FROM project) AND s.state <> 'closed'
                FOR SHARE)`
            : sql`TRUE`,
          watch: false,
        };
    }
  }

  function statement(actorId: string, projectId: string, input: BulkEditData): SQL {
    const { change } = input;
    /** `before`: CTEs the gate refers to (they must come first). */
    const head = (column: SQL, gate: SQL, before: SQL = sql``) => sql`
      WITH project AS (SELECT ${projectId}::uuid AS id),
      ${before}
      target AS (
        SELECT i.id, i.number, ${column} AS v FROM issues i
        WHERE i.id IN ${uuidList(input.issueIds)}
          AND i.project_id = (SELECT id FROM project) AND i.deleted_at IS NULL
        FOR UPDATE OF i
      ),
      gate AS (
        SELECT (SELECT count(*) FROM target) = ${input.issueIds.length} AND ${gate} AS ok
      ),`;
    const tail = sql`
      SELECT (SELECT ok FROM gate) AS ok,
        (SELECT count(*)::int FROM target) AS found,
        (SELECT count(*)::int FROM act) AS changed,
        COALESCE((SELECT json_agg(json_build_object('activityId', act.id::text,
            'issueId', act.entity_id::text, 'number', target.number, 'to', act.to_value,
            'watchers', (SELECT json_agg(w.user_id::text) FROM watchers w
              WHERE w.issue_id = act.entity_id)))
          FROM act JOIN target ON target.id = act.entity_id), '[]'::json) AS events`;

    if (change.kind === "delete") {
      return sql`${head(sql`NULL::text`, sql`TRUE`)}
        changed AS (
          UPDATE issues SET deleted_at = now(), updated_at = now()
          FROM target WHERE issues.id = target.id AND (SELECT ok FROM gate)
          RETURNING issues.id
        ),
        act AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action)
          SELECT 'issue', id, ${actorId}::uuid, 'deleted' FROM changed
          RETURNING id, entity_id, to_value
        )
        ${tail}`;
    }

    if (change.kind === "addLabels" || change.kind === "removeLabels") {
      const labelGate = sql`(SELECT count(*) FROM lbl) = ${change.labelIds.length}`;
      const lbl = sql`lbl AS (
          SELECT id, name FROM labels
          WHERE id IN ${uuidList(change.labelIds)} AND project_id = ${projectId}::uuid
        ),`;
      if (change.kind === "addLabels") {
        return sql`${head(sql`NULL::text`, labelGate, lbl)}
          touched AS (
            INSERT INTO issue_labels (issue_id, label_id)
            SELECT target.id, lbl.id FROM target, lbl WHERE (SELECT ok FROM gate)
            ON CONFLICT DO NOTHING
            RETURNING issue_id, label_id
          ),
          act AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value,
              meta)
            SELECT 'issue', t.issue_id, ${actorId}::uuid, 'label_added', 'labels',
              t.label_id::text, jsonb_build_object('name', lbl.name)
            FROM touched t JOIN lbl ON lbl.id = t.label_id
            RETURNING id, entity_id, to_value
          )
          ${tail}`;
      }
      return sql`${head(sql`NULL::text`, labelGate, lbl)}
        touched AS (
          DELETE FROM issue_labels il USING target, lbl
          WHERE il.issue_id = target.id AND il.label_id = lbl.id AND (SELECT ok FROM gate)
          RETURNING il.issue_id, il.label_id
        ),
        act AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            meta)
          SELECT 'issue', t.issue_id, ${actorId}::uuid, 'label_removed', 'labels',
            t.label_id::text, jsonb_build_object('name', lbl.name)
          FROM touched t JOIN lbl ON lbl.id = t.label_id
          RETURNING id, entity_id, to_value
        )
        ${tail}`;
    }

    const write = fieldWrite(change);
    const col = sql.identifier(write.column);
    const watch = write.watch
      ? sql`watch AS (
          INSERT INTO watchers (issue_id, user_id)
          SELECT id, to_value::uuid FROM changed
          ON CONFLICT DO NOTHING
        ),`
      : sql``;
    return sql`${head(sql`i.${col}::text`, write.gate)}
      changed AS (
        UPDATE issues SET ${col} = ${write.value}, ${write.alsoSet} updated_at = now()
        FROM target
        WHERE issues.id = target.id AND (SELECT ok FROM gate)
          AND target.v IS DISTINCT FROM (${write.value})::text
        RETURNING issues.id, target.v AS from_value, issues.${col}::text AS to_value
      ),
      ${watch}
      act AS (
        INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
          to_value)
        SELECT 'issue', id, ${actorId}::uuid, 'updated', ${write.field}, from_value, to_value
        FROM changed
        RETURNING id, entity_id, to_value
      )
      ${tail}`;
  }

  /** NTF-1, after the write: new assignees, and watchers of issues whose status changed. */
  async function notifyChanges(
    actorId: string,
    projectKey: string,
    change: BulkEditData["change"],
    events: z.infer<typeof resultRow>["events"],
  ) {
    const { notify } = options;
    if (!notify || (change.kind !== "assignee" && change.kind !== "status")) return;
    await Promise.all(
      events.map(async (event) => {
        const recipients =
          change.kind === "assignee" ? (event.to ? [event.to] : []) : (event.watchers ?? []);
        if (recipients.length === 0) return;
        try {
          await notify({
            type: change.kind === "assignee" ? "assigned" : "status_on_watched",
            recipients,
            actorId,
            entity: { type: "issue", id: event.issueId },
            meta: { issueKey: formatIssueKey(projectKey, event.number), to: event.to },
            dedupeKey: `${change.kind === "assignee" ? "assigned" : "status"}:${event.activityId}`,
          });
        } catch (error) {
          // A notification never fails the edit (see notifications.ts).
          console.error("bulk edit: notify failed", error);
        }
      }),
    );
  }

  return {
    async bulkEdit(actorId: string, input: BulkEditData): Promise<BulkEditResult> {
      if (input.issueIds.length > BULK_MAX) {
        throw invalid(`Select at most ${BULK_MAX} issues at once`);
      }
      const [project, live] = await allInOrder([
        projectByKey(input.projectKey),
        liveCount(input.projectKey, input.issueIds),
        checkTarget(input.projectKey, input.change),
      ]);
      if (live !== input.issueIds.length) {
        throw invalid(
          `${input.issueIds.length - live} of the selected issues are not live issues of ${project.key}; reload and try again`,
        );
      }
      const result = await db.execute(statement(actorId, project.id, input));
      const [row] = rowsOf(result, resultRow);
      if (!row) throw new Error("bulk edit returned no row");
      if (!row.ok) {
        if (row.found !== input.issueIds.length) {
          throw conflict("Some of the selected issues changed meanwhile; reload and try again");
        }
        // The target went away between the check and the write: report it as the check does.
        await checkTarget(input.projectKey, input.change);
        throw conflict("That change is no longer possible; reload and try again");
      }
      await notifyChanges(actorId, project.key, input.change, row.events);
      return { changed: row.changed };
    },
  };
}

export type BulkService = ReturnType<typeof createBulkService>;
