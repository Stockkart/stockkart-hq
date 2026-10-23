import { and, asc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import { ISSUE_TYPES, type IssueType } from "@/lib/issues/constants";
import { convertProblem } from "@/lib/issues/convert";
import { formatIssueKey, parseIssueKey } from "@/lib/issues/keys";
import { toStoredLink, viewLink } from "@/lib/issues/links";
import { extractUserMentionIds } from "@/lib/mentions";
import {
  type addLabelInput,
  type addLinkInput,
  type createIssueInput,
  TITLE_MAX,
  type updateIssueFieldInput,
} from "@/lib/issues/schemas";
import { extractPlainText, type RichTextDoc } from "@/lib/rich-text";
import {
  components,
  issues,
  projects,
  releases,
  sprints,
  statuses,
  users,
} from "@/server/db/schema";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";

import { conflict, invalid, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";
import {
  notificationsInsert,
  userMentionNotifyCtes,
  userMentionNotifyStatement,
  watcherStatusNotifications,
} from "./notifications";
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
  userMentionSyncCtes,
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
  /**
   * ISS-14 clone: the live issue this one copies. The same statement copies its labels and
   * story points, links the two with `relates`, logs `cloned` on the source and the source
   * in the `created` row's meta. Copied @mentions are linked but nobody is notified (the
   * actor did not write them), as for docs made from a template.
   */
  cloneOf?: { issueId: string; key: string; storyPoints: number | null };
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

  /** REL-1: a fix version is a release of the issue's own project (any state). */
  async function checkRelease(projectId: IdRef, releaseId: string | null) {
    if (!releaseId) return;
    const [row] = await read(
      db
        .select({ id: releases.id })
        .from(releases)
        .where(and(eq(releases.id, releaseId), eq(releases.projectId, projectId)))
        .limit(1),
    );
    if (!row) throw notFound("Release");
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

  /**
   * RDM-1: sets `start_date` and `due_date` in ONE statement, with one `startDate` /
   * `dueDate` activity row per date that really changed (raw ISO dates, like `dueDate`).
   * The row lock in `old` orders concurrent bar moves; the last one wins as a whole.
   */
  async function writeSchedule(
    actorId: string,
    issueId: string,
    value: { startDate: string | null; dueDate: string | null },
  ): Promise<FieldChange> {
    const result = await db.execute(sql`
      WITH old AS (
        SELECT id, start_date::text AS s, due_date::text AS d FROM issues
        WHERE id = ${issueId}::uuid AND deleted_at IS NULL
        FOR UPDATE
      ),
      changed AS (
        UPDATE issues SET start_date = ${value.startDate}::date, due_date = ${value.dueDate}::date,
          updated_at = CASE
            WHEN old.s IS DISTINCT FROM ${value.startDate}::date::text
              OR old.d IS DISTINCT FROM ${value.dueDate}::date::text
              THEN now()
            ELSE issues.updated_at
          END
        FROM old WHERE issues.id = old.id
        RETURNING issues.id, old.s AS from_start, old.d AS from_due,
          issues.start_date::text AS to_start, issues.due_date::text AS to_due
      ),
      field_activity AS (
        INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
          to_value)
        SELECT 'issue', c.id, ${actorId}::uuid, 'updated', v.field, v.from_value, v.to_value
        FROM changed c, LATERAL (VALUES
          ('startDate', c.from_start, c.to_start),
          ('dueDate', c.from_due, c.to_due)
        ) AS v(field, from_value, to_value)
        WHERE v.from_value IS DISTINCT FROM v.to_value
      )
      SELECT from_start, from_due, to_start, to_due FROM changed
    `);
    const date = z.string().nullable();
    const [row] = rowsOf(
      result,
      z.object({ from_start: date, from_due: date, to_start: date, to_due: date }),
    );
    if (!row) throw notFound("Issue");
    // ISO 8601 interval notation, an empty side for a missing date.
    const from = `${row.from_start ?? ""}/${row.from_due ?? ""}`;
    const to = `${row.to_start ?? ""}/${row.to_due ?? ""}`;
    return { from, to, changed: from !== to };
  }

  const api = {
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
     *
     * The same statement makes the reporter and the assignee watchers (ISS-11) and notifies
     * the assignee and the @mentioned users (NTF-1), never the actor.
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
      const releaseId = input.releaseId ?? null;
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
        checkRelease(projectRef, releaseId),
      ]);
      checkParent({ projectId: project.id, type: input.type }, parent);
      // PRJ-3: no assignee given (not even "unassigned") → the project's default assignee,
      // read in the insert itself (no extra round trip).
      const assigneeValue =
        input.assigneeId === undefined
          ? sql`(SELECT default_assignee_id FROM projects WHERE id = ${project.id}::uuid)`
          : uuidOrNull(assigneeId);
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
      // REL-1: the fix version is re-checked (and share-locked against a delete) at write time.
      const releaseGate = releaseId
        ? sql`AND EXISTS (
            SELECT 1 FROM releases r WHERE r.id = ${releaseId}::uuid
              AND r.project_id = ${project.id}::uuid
            FOR SHARE
          )`
        : sql``;
      const todoLink = todoId
        ? sql`promoted_todo AS (
              UPDATE todos SET promoted_issue_id = inserted.id, updated_at = now()
              FROM inserted WHERE todos.id = ${todoId}::uuid
            ),`
        : sql``;
      const clone = extra.cloneOf ?? null;
      // ISS-14: the source must still be live at write time; the share lock orders this
      // against a concurrent delete of it.
      const cloneGate = clone
        ? sql`AND EXISTS (
            SELECT 1 FROM issues src WHERE src.id = ${clone.issueId}::uuid
              AND src.project_id = ${project.id}::uuid AND src.deleted_at IS NULL
            FOR SHARE
          )`
        : sql``;
      const createdMeta = clone
        ? sql`jsonb_build_object('clonedFromId', ${clone.issueId}::text,
            'clonedFromKey', ${clone.key}::text)`
        : sql`NULL::jsonb`;
      const cloneCtes = clone
        ? sql`
            cloned_labels AS (
              INSERT INTO issue_labels (issue_id, label_id)
              SELECT inserted.id, il.label_id FROM inserted, issue_labels il
              WHERE il.issue_id = ${clone.issueId}::uuid
              ON CONFLICT DO NOTHING
            ),
            clone_link AS (
              INSERT INTO issue_links (source_issue_id, target_issue_id, type, created_by)
              SELECT inserted.id, ${clone.issueId}::uuid, 'relates', ${actorId}::uuid
              FROM inserted
              RETURNING source_issue_id, target_issue_id
            ),
            clone_link_activity AS (
              INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value,
                meta)
              SELECT 'issue', v.issue_id, ${actorId}::uuid, 'link_added', 'links', v.other_id,
                jsonb_build_object('relation', 'relates')
              FROM clone_link l, LATERAL (VALUES
                (l.source_issue_id, l.target_issue_id::text),
                (l.target_issue_id, l.source_issue_id::text)
              ) AS v(issue_id, other_id)
            ),
            clone_source_activity AS (
              INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value,
                meta)
              SELECT 'issue', ${clone.issueId}::uuid, ${actorId}::uuid, 'cloned', 'links',
                inserted.id::text,
                jsonb_build_object('cloneKey', ${project.key}::text || '-' || inserted.number)
              FROM inserted
            ),`
        : sql``;
      const mentionGate = sql`EXISTS (SELECT 1 FROM inserted)`;
      const mentionedUserIds = extractUserMentionIds(description);

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
              WHERE id = ${project.id}::uuid ${todoGate} ${sprintGate} ${releaseGate}
                ${cloneGate}
              RETURNING issue_counter
            ),
            inserted AS (
              INSERT INTO issues (id, project_id, number, type, title, description,
                description_text, status_id, priority, assignee_id, reporter_id, parent_id,
                component_id, sprint_id, release_id, story_points, rank)
              SELECT ${id}::uuid, ${project.id}::uuid, counter.issue_counter,
                ${input.type}::issue_type, ${input.title}, ${jsonbOrNull(description)},
                ${descriptionText}, ${statusId}::uuid, ${input.priority}::smallint,
                ${assigneeValue}, ${actorId}::uuid, ${uuidOrNull(parentId)},
                ${uuidOrNull(componentId)}, ${uuidOrNull(sprintId)}, ${uuidOrNull(releaseId)},
                ${clone?.storyPoints ?? null}::int, ${rank}
              FROM counter
              RETURNING id, number, sprint_id, assignee_id, release_id
            ),
            created_activity AS (
              INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value, meta)
              SELECT 'issue', inserted.id, ${actorId}::uuid, 'created', ${input.type},
                ${createdMeta}
              FROM inserted
            ),
            -- BLG-3/SPR-3: created straight into a sprint counts as joining it (burndown).
            sprint_activity AS (
              INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value)
              SELECT 'issue', inserted.id, ${actorId}::uuid, 'updated', 'sprint',
                inserted.sprint_id::text
              FROM inserted WHERE inserted.sprint_id IS NOT NULL
            ),
            -- REL-1: created with a fix version (the activity row of that field).
            release_activity AS (
              INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value)
              SELECT 'issue', inserted.id, ${actorId}::uuid, 'updated', 'release',
                inserted.release_id::text
              FROM inserted WHERE inserted.release_id IS NOT NULL
            ),
            ${todoLink}
            ${cloneCtes}
            ${mentionSyncCtes({
              // Safe inline: the issue is new, so no other request can be syncing it.
              fromType: "issue",
              fromId: id,
              refs,
              actorId,
              gate: mentionGate,
            })},
            ${
              clone
                ? // ISS-14: the copied mentions are linked, uncredited, and notify nobody.
                  userMentionSyncCtes({
                    fromType: "issue",
                    fromId: id,
                    userIds: mentionedUserIds,
                    actorId: null,
                    gate: mentionGate,
                  })
                : userMentionNotifyCtes(
                    {
                      fromType: "issue",
                      fromId: id,
                      userIds: mentionedUserIds,
                      actorId,
                      gate: mentionGate,
                    },
                    {
                      type: sql`'mentioned'`,
                      entityType: sql`'issue'`,
                      entityId: sql`${id}::uuid`,
                      meta: sql`'{}'::jsonb`,
                    },
                  )
            },
            -- ISS-11: the reporter and the assignee watch the new issue.
            auto_watch AS (
              INSERT INTO watchers (issue_id, user_id)
              SELECT DISTINCT inserted.id, u.user_id
              FROM inserted, LATERAL (VALUES (${actorId}::uuid), (inserted.assignee_id)) AS u(user_id)
              WHERE u.user_id IS NOT NULL
              ON CONFLICT DO NOTHING
            ),
            -- NTF-1: created with someone else as the assignee.
            assigned_notified AS (
              ${notificationsInsert({
                actorId,
                source: sql`
                  SELECT inserted.assignee_id AS user_id, 'assigned'::text AS type,
                    'issue'::text AS entity_type, inserted.id AS entity_id,
                    'assigned:created:' || inserted.id::text AS event_key, '{}'::jsonb AS meta
                  FROM inserted`,
              })}
            )
            SELECT id, number FROM inserted
          `);
          const [row] = rowsOf(result, z.object({ id: z.string(), number: z.number() }));
          if (!row) {
            // The sprint was closed or deleted since the check: report it as the check does.
            if (sprintId) await checkSprint(project.id, sprintId);
            if (releaseId) await checkRelease(project.id, releaseId);
            // ISS-14: the source was deleted since it was read.
            if (clone) throw notFound("Issue to clone");
            // Promote: the todo is not the actor's, does not exist or was already promoted.
            throw todoId
              ? notFound("Todo (or it was already promoted)")
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
     * transaction (see `mentionSyncCtes` for why it cannot be part of the first), and a third
     * notifies the users it newly @mentions. A status change notifies the issue's watchers,
     * an assignee change makes the new assignee a watcher and notifies them, both in the
     * write itself (ISS-11, NTF-1; never the actor).
     */
    async updateIssueField(actorId: string, input: UpdateIssueFieldData): Promise<FieldChange> {
      if (input.field === "schedule") return writeSchedule(actorId, input.issueId, input.value);
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
            case "release":
              await checkRelease(projectRef, input.value);
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
      let mentionSync: SQL[] = [];
      // CTEs after `field_activity` (which RETURNS the activity row when the value changed):
      // the watchers and bell entries of this change, in the same statement (ISS-11, NTF-1).
      let followUps: SQL = sql``;

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
          const liveGate = sql`EXISTS (SELECT 1 FROM issues WHERE id = ${issue.id}::uuid AND deleted_at IS NULL)`;
          mentionSync = [
            mentionSyncStatement({
              fromType: "issue",
              fromId: issue.id,
              refs: docRefs(doc, checked.projectKeys ?? []),
              actorId,
              gate: liveGate,
            }),
            // Only the users this save newly mentions are notified (NTF-1).
            userMentionNotifyStatement(
              {
                fromType: "issue",
                fromId: issue.id,
                userIds: extractUserMentionIds(doc),
                actorId,
                gate: liveGate,
              },
              {
                type: sql`'mentioned'`,
                entityType: sql`'issue'`,
                entityId: sql`${issue.id}::uuid`,
                meta: sql`'{}'::jsonb`,
              },
            ),
          ];
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
          followUps = sql`,
            status_notified AS (
              ${watcherStatusNotifications(actorId, sql`field_activity`, sql`'{}'::jsonb`)}
            )`;
          break;
        }
        case "priority":
          column = "priority";
          value = sql`${input.value}::smallint`;
          break;
        case "assignee":
          column = "assignee_id";
          value = uuidOrNull(input.value);
          // ISS-11: the new assignee watches the issue; NTF-1: and is told (unless it is the
          // actor). Both only when the assignee really changed (`field_activity` has a row).
          followUps = sql`,
            assignee_watch AS (
              INSERT INTO watchers (issue_id, user_id)
              SELECT entity_id, to_value::uuid FROM field_activity WHERE to_value IS NOT NULL
              ON CONFLICT DO NOTHING
            ),
            assigned_notified AS (
              ${notificationsInsert({
                actorId,
                source: sql`
                  SELECT to_value::uuid AS user_id, 'assigned'::text AS type,
                    'issue'::text AS entity_type, entity_id,
                    'assigned:' || id::text AS event_key, '{}'::jsonb AS meta
                  FROM field_activity WHERE to_value IS NOT NULL`,
              })}
            )`;
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
          // RDM-1: never before the start date (the roadmap bar would run backwards).
          if (input.value) {
            alsoWhere = sql`AND (issues.start_date IS NULL OR issues.start_date <= ${input.value}::date)`;
          }
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
        case "release":
          column = "release_id";
          value = uuidOrNull(input.value);
          // REL-1: re-checked at write time (the release may have been deleted since); the
          // share lock orders this against a concurrent delete, which counts its issues.
          if (input.value) {
            alsoWhere = sql`AND EXISTS (
              SELECT 1 FROM releases r WHERE r.id = ${input.value}::uuid
                AND r.project_id = issues.project_id
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
          RETURNING id, entity_id, from_value, to_value
        )
        ${followUps}
        SELECT from_value, to_value FROM changed
      `;
      const [result] =
        mentionSync.length > 0
          ? await options.runAtomic([write, ...mentionSync])
          : [await db.execute(write)];
      const [row] = rowsOf(
        result,
        z.object({ from_value: z.string().nullable(), to_value: z.string().nullable() }),
      );
      // No row: the issue was deleted meanwhile, or (parent/sprint) the target went away.
      if (!row) {
        if (input.field === "dueDate") {
          const [current] = await db
            .select({ startDate: issues.startDate })
            .from(issues)
            .where(and(eq(issues.id, issue.id), isNull(issues.deletedAt)))
            .limit(1);
          if (current?.startDate) {
            throw invalid(`The due date is before the start date (${current.startDate})`);
          }
        }
        throw notFound(
          input.field === "parent"
            ? "Issue or parent issue"
            : input.field === "sprint"
              ? "Issue or open sprint"
              : input.field === "release"
                ? "Issue or release"
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

    /** Soft delete; restorable from the trash for 30 days (ISS-13, `trash.ts`). Children and
     * links are kept. */
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

    /**
     * ISS-14 clone: a new issue in the same project with the same type, "Copy of <title>",
     * description, priority, component, labels, story points and parent. Not copied:
     * comments, links, attachments' ownership, watchers, GitHub refs, the sprint, the
     * status (the new issue starts in the default one) or the assignee (the project default
     * applies, as for any new issue). Then a `relates` link to the original and activity on
     * both, all in `createIssue`'s one statement.
     */
    async cloneIssue(actorId: string, input: { issueId: string }): Promise<CreatedIssue> {
      const [source] = await read(
        db
          .select({
            id: issues.id,
            number: issues.number,
            type: issues.type,
            title: issues.title,
            description: issues.description,
            priority: issues.priority,
            componentId: issues.componentId,
            parentId: issues.parentId,
            storyPoints: issues.storyPoints,
            projectKey: projects.key,
          })
          .from(issues)
          .innerJoin(projects, eq(projects.id, issues.projectId))
          .where(and(eq(issues.id, input.issueId), isNull(issues.deletedAt)))
          .limit(1),
      );
      if (!source) throw notFound("Issue");
      return api.createIssue(
        actorId,
        {
          projectKey: source.projectKey,
          title: cloneTitle(source.title),
          type: source.type,
          priority: source.priority,
          description: source.description,
          parentId: source.parentId,
          componentId: source.componentId,
        },
        {
          cloneOf: {
            issueId: source.id,
            key: formatIssueKey(source.projectKey, source.number),
            storyPoints: source.storyPoints,
          },
        },
      );
    },

    /**
     * ISS-14 convert: changes the issue's type, refused when the ISS-3 parent rules would
     * break for the issue's parent or any live child (`convertProblem`). Two statements in
     * one transaction: the first row-locks the issue and its parent (in id order, so two
     * converts never deadlock). That orders this against inserts or moves of children (they
     * take a key-share lock on the issue row) and against a concurrent convert of the
     * parent, so the second statement's re-check of the parent and the children sees the
     * committed rows; it then writes the change with a `type` activity row.
     */
    async convertIssueType(
      actorId: string,
      input: { issueId: string; type: IssueType },
    ): Promise<FieldChange> {
      const subject = async () => {
        const result = await read(
          db.execute(sql`
            SELECT i.type::text AS type, p.type::text AS parent_type,
              (p.deleted_at IS NOT NULL) AS parent_deleted,
              COALESCE((SELECT json_agg(c.type::text) FROM issues c
                WHERE c.parent_id = i.id AND c.deleted_at IS NULL), '[]'::json) AS child_types
            FROM issues i LEFT JOIN issues p ON p.id = i.parent_id
            WHERE i.id = ${input.issueId}::uuid AND i.deleted_at IS NULL
          `),
        );
        const type = z.enum(ISSUE_TYPES);
        const [row] = rowsOf(
          result,
          z.object({
            type,
            parent_type: type.nullable(),
            parent_deleted: z.boolean(),
            child_types: z.array(type),
          }),
        );
        if (!row) throw notFound("Issue");
        return row;
      };
      const current = await subject();
      if (current.type === input.type) {
        return { from: current.type, to: current.type, changed: false };
      }
      const problem = convertProblem(
        { type: current.type, parentType: current.parent_type, childTypes: current.child_types },
        input.type,
      );
      if (problem) throw invalid(problem);
      if (input.type === "subtask" && current.parent_deleted) {
        throw invalid("The parent issue has been deleted; pick another parent first");
      }

      const target = sql`${input.type}::issue_type`;
      // The same rules as `convertProblem`, in SQL, against the rows as committed.
      const parentAllowed =
        input.type === "epic"
          ? sql`issues.parent_id IS NULL`
          : input.type === "subtask"
            ? sql`EXISTS (SELECT 1 FROM issues p WHERE p.id = issues.parent_id
                AND p.deleted_at IS NULL AND p.type NOT IN ('epic', 'subtask'))`
            : sql`(issues.parent_id IS NULL OR EXISTS (SELECT 1 FROM issues p
                WHERE p.id = issues.parent_id AND p.type = 'epic'))`;
      const childRefused =
        input.type === "epic"
          ? sql`c.type IN ('epic', 'subtask')`
          : input.type === "subtask"
            ? sql`TRUE`
            : sql`c.type <> 'subtask'`;
      const results = await options.runAtomic([
        sql`
          SELECT id FROM issues
          WHERE id = ${input.issueId}::uuid
            OR id = (SELECT parent_id FROM issues WHERE id = ${input.issueId}::uuid)
          ORDER BY id
          FOR UPDATE
        `,
        sql`
          WITH old AS (
            SELECT id, type::text AS from_value FROM issues
            WHERE id = ${input.issueId}::uuid AND deleted_at IS NULL AND type <> ${target}
          ),
          changed AS (
            UPDATE issues SET type = ${target}, updated_at = now()
            FROM old
            WHERE issues.id = old.id AND ${parentAllowed}
              AND NOT EXISTS (SELECT 1 FROM issues c
                WHERE c.parent_id = issues.id AND c.deleted_at IS NULL AND ${childRefused})
            RETURNING issues.id, old.from_value
          ),
          field_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
              to_value)
            SELECT 'issue', id, ${actorId}::uuid, 'updated', 'type', from_value, ${input.type}
            FROM changed
          )
          SELECT from_value FROM changed
        `,
      ]);
      const [row] = rowsOf(results.at(-1), z.object({ from_value: z.string() }));
      if (row) return { from: row.from_value, to: input.type, changed: true };
      // Changed meanwhile: report what is in the way now.
      const now = await subject();
      if (now.type === input.type) return { from: now.type, to: now.type, changed: false };
      throw invalid(
        convertProblem(
          { type: now.type, parentType: now.parent_type, childTypes: now.child_types },
          input.type,
        ) ?? "The issue changed meanwhile; reload and try again",
      );
    },
  };
  return api;
}

/** "Copy of <title>", cut to the title limit (never splitting a surrogate pair). */
export function cloneTitle(title: string): string {
  return `Copy of ${title}`.slice(0, TITLE_MAX).replace(/[\uD800-\uDBFF]$/, "");
}

export type IssueService = ReturnType<typeof createIssueService>;
