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
import { components, issues, projects, sprints, statuses, users } from "@/server/db/schema";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";

import { conflict, invalid, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";
import { allInOrder } from "./parallel";
import { parentProblem } from "./parent-rules";
import {
  docRefs,
  type IdRef,
  jsonbOrNull,
  mentionSyncCtes,
  mentionSyncStatement,
  projectIdByKey,
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

/** Optional side effects of `createIssue`, written in the same statement. */
export interface CreateIssueExtra {
  /** MY-3: the actor's todo to link to the new issue (`todos.promoted_issue_id`). */
  promoteTodoId?: string;
}

/** Number of attempts when two creators race for the same top-of-backlog rank. */
const RANK_ATTEMPTS = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface IssueServiceOptions {
  /** Transactions of several statements (see `RunAtomic`). */
  runAtomic: RunAtomic;
  /** How the validation reads run; on Neon, reads started together share a round trip. */
  read?: Read;
  /** Test hook: runs between reading the current top rank and the insert. */
  beforeInsert?: () => Promise<void>;
}

export function createIssueService(db: AppDatabase, options: IssueServiceOptions) {
  const read = options.read ?? directRead;

  async function projectByKey(key: string) {
    const [project] = await read(
      db
        .select({ id: projects.id, key: projects.key })
        .from(projects)
        .where(and(eq(projects.key, key), isNull(projects.archivedAt)))
        .limit(1),
    );
    if (!project) throw notFound(`Project ${key}`);
    return project;
  }

  async function liveIssue(issueId: string) {
    const [issue] = await read(
      db
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
        .limit(1),
    );
    if (!issue) throw notFound("Issue");
    return issue;
  }

  async function allProjectKeys(): Promise<string[]> {
    const rows = await read(db.select({ key: projects.key }).from(projects));
    return rows.map((row) => row.key);
  }

  /** The would-be parent (deleted ones included, for the message), or null for none. */
  async function parentRow(parentId: string | null) {
    if (!parentId) return null;
    const [row] = await read(
      db
        .select({
          id: issues.id,
          projectId: issues.projectId,
          type: issues.type,
          deletedAt: issues.deletedAt,
        })
        .from(issues)
        .where(eq(issues.id, parentId))
        .limit(1),
    );
    if (!row) throw notFound("Parent issue");
    return row;
  }

  function checkParent(
    child: { id?: string; projectId: string; type: IssueType },
    parent: Awaited<ReturnType<typeof parentRow>>,
  ) {
    const problem = parentProblem(child, parent);
    if (problem) throw invalid(problem);
  }

  async function checkUser(userId: string | null) {
    if (!userId) return;
    const [row] = await read(
      db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1),
    );
    if (!row) throw notFound("User");
  }

  async function checkComponent(projectId: IdRef, componentId: string | null) {
    if (!componentId) return;
    const [row] = await read(
      db
        .select({ id: components.id })
        .from(components)
        .where(and(eq(components.id, componentId), eq(components.projectId, projectId)))
        .limit(1),
    );
    if (!row) throw notFound("Component");
  }

  /** BLG-3: issues go into a planned or active sprint of their own project only. */
  async function checkSprint(projectId: IdRef, sprintId: string | null) {
    if (!sprintId) return;
    const [row] = await read(
      db
        .select({ state: sprints.state })
        .from(sprints)
        .where(and(eq(sprints.id, sprintId), eq(sprints.projectId, projectId)))
        .limit(1),
    );
    if (!row) throw notFound("Sprint");
    if (row.state === "closed") throw invalid("That sprint is closed; pick an open one");
  }

  async function checkStatus(projectId: IdRef, statusId: string) {
    const [status] = await read(
      db
        .select({ id: statuses.id })
        .from(statuses)
        .where(and(eq(statuses.id, statusId), eq(statuses.projectId, projectId)))
        .limit(1),
    );
    if (!status) throw notFound("Status");
  }

  /** §4.4: Triage for bugs, Backlog for everything else; else the first status. */
  async function defaultStatusId(projectId: IdRef, type: IssueType): Promise<string> {
    const wanted = type === "bug" ? "bug" : "other";
    const rows = await read(
      db
        .select({ id: statuses.id, isDefaultFor: statuses.isDefaultFor })
        .from(statuses)
        .where(eq(statuses.projectId, projectId))
        .orderBy(asc(statuses.position)),
    );
    const status = rows.find((row) => row.isDefaultFor === wanted) ?? rows[0];
    if (!status) throw invalid("The project has no statuses; run the seed first");
    return status.id;
  }

  async function topRank(projectId: IdRef): Promise<string | null> {
    // Deleted issues keep their rank, and ranks are unique per project, so include them.
    const [row] = await read(
      db
        .select({ rank: issues.rank })
        .from(issues)
        .where(eq(issues.projectId, projectId))
        .orderBy(asc(issues.rank))
        .limit(1),
    );
    return row?.rank ?? null;
  }

  /** The project of a (live or not) issue, as a subquery for checks that run with it. */
  const projectOfIssue = (issueId: string) =>
    sql`(SELECT project_id FROM issues WHERE id = ${issueId}::uuid)`;

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
     *
     * MY-3 promote (`extra.promoteTodoId`): the same statement first row-locks the actor's
     * OWN, not-yet-promoted todo (`todo_lock`), creates the issue only if that row exists,
     * and points the todo at the new issue. Under READ COMMITTED a concurrent promote of the
     * same todo waits for the lock, re-checks `promoted_issue_id IS NULL` on the committed
     * row, finds it set and creates nothing, so a double click cannot make two issues.
     */
    async createIssue(
      actorId: string,
      input: CreateIssueData,
      extra: CreateIssueExtra = {},
    ): Promise<CreatedIssue> {
      const parentId = input.parentId ?? null;
      const assigneeId = input.assigneeId ?? null;
      const componentId = input.componentId ?? null;
      const sprintId = input.sprintId ?? null;
      // Every check and lookup in one batched round trip; the project is referenced by key,
      // so nothing waits for it. Errors keep the old order (project first).
      const projectRef = projectIdByKey(input.projectKey);
      const [project, parent, , , , statusId, projectKeys, firstTopRank] = await allInOrder([
        projectByKey(input.projectKey),
        parentRow(parentId),
        checkUser(assigneeId),
        checkComponent(projectRef, componentId),
        checkSprint(projectRef, sprintId),
        defaultStatusId(projectRef, input.type),
        allProjectKeys(),
        topRank(projectRef),
      ]);
      checkParent({ projectId: project.id, type: input.type }, parent);
      const description = input.description ?? null;
      const descriptionText = description ? extractPlainText(description) : "";
      const refs = docRefs(description, projectKeys);
      const todoId = extra.promoteTodoId ?? null;
      const todoLock = todoId
        ? sql`todo_lock AS (
              SELECT id FROM todos
              WHERE id = ${todoId}::uuid AND user_id = ${actorId}::uuid
                AND promoted_issue_id IS NULL
              FOR UPDATE
            ),`
        : sql``;
      const todoGate = todoId ? sql`AND EXISTS (SELECT 1 FROM todo_lock)` : sql``;
      // BLG-3: the sprint is re-checked (and share-locked, ordering this against a start or
      // completion of it) at write time; a sprint closed since the check creates nothing.
      const sprintGate = sprintId
        ? sql`AND EXISTS (
            SELECT 1 FROM sprints s WHERE s.id = ${sprintId}::uuid
              AND s.project_id = ${project.id}::uuid AND s.state <> 'closed'
            FOR SHARE
          )`
        : sql``;
      const todoLink = todoId
        ? sql`promoted_todo AS (
              UPDATE todos SET promoted_issue_id = inserted.id, updated_at = now()
              FROM inserted WHERE todos.id = ${todoId}::uuid
            ),`
        : sql``;

      for (let attempt = 1; ; attempt += 1) {
        const id = crypto.randomUUID();
        // The first attempt uses the top rank read with the checks above.
        const rank = generateKeyBetween(
          null,
          attempt === 1 ? firstTopRank : await topRank(project.id),
        );
        await options.beforeInsert?.();
        try {
          const result = await db.execute(sql`
            WITH ${todoLock}
            counter AS (
              UPDATE projects SET issue_counter = issue_counter + 1, updated_at = now()
              WHERE id = ${project.id}::uuid ${todoGate} ${sprintGate}
              RETURNING issue_counter
            ),
            inserted AS (
              INSERT INTO issues (id, project_id, number, type, title, description,
                description_text, status_id, priority, assignee_id, reporter_id, parent_id,
                component_id, sprint_id, rank)
              SELECT ${id}::uuid, ${project.id}::uuid, counter.issue_counter,
                ${input.type}::issue_type, ${input.title}, ${jsonbOrNull(description)},
                ${descriptionText}, ${statusId}::uuid, ${input.priority}::smallint,
                ${uuidOrNull(assigneeId)}, ${actorId}::uuid, ${uuidOrNull(parentId)},
                ${uuidOrNull(componentId)}, ${uuidOrNull(sprintId)}, ${rank}
              FROM counter
              RETURNING id, number, sprint_id
            ),
            created_activity AS (
              INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value)
              SELECT 'issue', inserted.id, ${actorId}::uuid, 'created', ${input.type}
              FROM inserted
            ),
            -- BLG-3/SPR-3: created straight into a sprint counts as joining it (burndown).
            sprint_activity AS (
              INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value)
              SELECT 'issue', inserted.id, ${actorId}::uuid, 'updated', 'sprint',
                inserted.sprint_id::text
              FROM inserted WHERE inserted.sprint_id IS NOT NULL
            ),
            ${todoLink}
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
          if (!row) {
            // Promote: the todo is not the actor's, does not exist or was already promoted.
            // With a sprint: it was closed or deleted since the check.
            throw todoId
              ? notFound("Todo (or it was already promoted)")
              : sprintId
                ? notFound(`Project ${input.projectKey} or open sprint`)
                : notFound(`Project ${input.projectKey}`);
          }
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
      // The issue and the field's own check are read together (one round trip); the check
      // finds the issue's project with a subquery. A missing issue is reported first.
      const projectRef = projectOfIssue(input.issueId);
      const [issue, checked] = await allInOrder([
        liveIssue(input.issueId),
        (async (): Promise<{
          projectKeys?: string[];
          parent?: Awaited<ReturnType<typeof parentRow>>;
        }> => {
          switch (input.field) {
            case "description":
              return { projectKeys: await allProjectKeys() };
            case "status":
              await checkStatus(projectRef, input.value);
              return {};
            case "assignee":
              await checkUser(input.value);
              return {};
            case "component":
              await checkComponent(projectRef, input.value);
              return {};
            case "parent":
              return { parent: await parentRow(input.value) };
            case "sprint":
              await checkSprint(projectRef, input.value);
              return {};
            default:
              return {};
          }
        })(),
      ]);
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
            refs: docRefs(doc, checked.projectKeys ?? []),
            actorId,
            gate: sql`EXISTS (SELECT 1 FROM issues WHERE id = ${issue.id}::uuid AND deleted_at IS NULL)`,
          });
          break;
        }
        case "status": {
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
          column = "assignee_id";
          value = uuidOrNull(input.value);
          break;
        case "component":
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
          checkParent(issue, checked.parent ?? null);
          column = "parent_id";
          value = uuidOrNull(input.value);
          // Re-checked at write time: the parent may have been deleted since the check.
          if (input.value) {
            alsoWhere = sql`AND EXISTS (
              SELECT 1 FROM issues p WHERE p.id = ${input.value}::uuid AND p.deleted_at IS NULL
            )`;
          }
          break;
        case "sprint":
          column = "sprint_id";
          value = uuidOrNull(input.value);
          // Re-checked at write time: the sprint may have been closed or deleted since. The
          // share lock orders this against a concurrent start or completion of the sprint.
          if (input.value) {
            alsoWhere = sql`AND EXISTS (
              SELECT 1 FROM sprints s WHERE s.id = ${input.value}::uuid
                AND s.project_id = issues.project_id AND s.state <> 'closed'
              FOR SHARE
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
      // No row: the issue was deleted meanwhile, or (parent/sprint) the target went away.
      if (!row) {
        throw notFound(
          input.field === "parent"
            ? "Issue or parent issue"
            : input.field === "sprint"
              ? "Issue or open sprint"
              : "Issue",
        );
      }
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
      const ref = parseIssueKey(input.targetKey);
      // Both lookups in one round trip; a missing source issue is reported first.
      const [issue, [target]] = await allInOrder([
        liveIssue(input.issueId),
        ref
          ? read(
              db
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
                .limit(1),
            )
          : Promise.resolve([]),
      ]);
      if (!ref) throw invalid("Enter an issue key such as STK-12");
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
