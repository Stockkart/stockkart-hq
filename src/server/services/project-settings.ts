import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { type StatusCategory, type StatusDefaultFor } from "@/lib/issues/constants";
import {
  type createComponentInput,
  type createLabelInput,
  type createStatusInput,
  type deleteStatusInput,
  type moveStatusInput,
  type renameComponentInput,
  type renameLabelInput,
  type renameStatusInput,
  type setAutoRetroInput,
  type setComponentRepoInput,
  type setLabelColorInput,
  type setStatusCategoryInput,
  type setStatusDefaultInput,
  type setStatusWipLimitInput,
  type updateProjectInput,
} from "@/lib/settings/schemas";
import { SPRINT_ACTIONS, WONT_DO_STATUS_NAME } from "@/lib/sprints/constants";
import { KEEP_ONE_VISIBLE_MESSAGE, type saveViewDefaultsInput } from "@/lib/views/view-defaults";
import { directRead, type Read } from "@/server/db/read-batch";
import { components, projects, statuses, users } from "@/server/db/schema";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";

import { conflict, invalid, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";
import { allInOrder } from "./parallel";
import { rowsOf, uuidOrNull } from "./sql";

const CATEGORY_LABELS: Record<StatusCategory, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};
const DEFAULT_LABELS: Record<StatusDefaultFor, string> = {
  bug: "new bugs",
  other: "other new issues",
};

const countRow = z.object({ n: z.number() });

/**
 * PRJ-2/PRJ-3 project settings: the general fields, the workflow (statuses), labels and
 * components.
 *
 * Workflow writes run as a `RunAtomic` transaction whose first statement takes a
 * per-project advisory lock, so the rules that span several statuses ("at least one status
 * per category", "one default per kind") are checked against the workflow as it is, never
 * a snapshot a concurrent change has already made stale. Deletes of a status, label or
 * component first row-lock it (`FOR UPDATE` conflicts with the key-share lock an issue
 * write takes on it), so an issue moved into it meanwhile is seen by the next statement
 * and moved or detached with its activity row instead of being missed.
 *
 * Every issue the settings change (a status deleted, a label or component removed) gets
 * its own activity row in the same transaction (ISS-8). The settings themselves have no
 * activity entity type (`entity_type` has no `project`/`status` value, and adding one needs
 * a migration), so only their effect on issues is recorded.
 */
export function createProjectSettingsService(
  db: AppDatabase,
  options: { runAtomic: RunAtomic; read?: Read },
) {
  const read = options.read ?? directRead;
  const { runAtomic } = options;

  const workflowLock = (projectId: SQL) =>
    sql`SELECT pg_advisory_xact_lock(hashtextextended('hq.workflow:' || ${projectId}::text, 0))`;
  const projectOfStatus = (statusId: string) =>
    sql`(SELECT project_id FROM statuses WHERE id = ${statusId}::uuid)`;

  async function projectByKey(key: string) {
    const [project] = await read(
      db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.key, key), isNull(projects.archivedAt)))
        .limit(1),
    );
    if (!project) throw notFound(`Project ${key}`);
    return project;
  }

  async function checkUser(userId: string | null) {
    if (!userId) return;
    const [row] = await read(
      db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1),
    );
    if (!row) throw notFound("User");
  }

  async function statusRow(statusId: string) {
    const [row] = await read(
      db
        .select({
          id: statuses.id,
          projectId: statuses.projectId,
          name: statuses.name,
          category: statuses.category,
          isDefaultFor: statuses.isDefaultFor,
        })
        .from(statuses)
        .where(eq(statuses.id, statusId))
        .limit(1),
    );
    if (!row) throw notFound("Status");
    return row;
  }

  /** Maps a unique violation of `constraint` to a friendly conflict. */
  async function uniquely<T>(constraint: string, message: string, run: () => Promise<T>) {
    try {
      return await run();
    } catch (error) {
      const info = pgErrorInfo(error);
      if (info?.code === UNIQUE_VIOLATION && info.constraint === constraint) {
        throw conflict(message);
      }
      throw error;
    }
  }

  /** The `RunAtomic` result of the last statement, as count rows. */
  const lastRows = <T extends z.ZodType>(results: unknown[], row: T) => rowsOf(results.at(-1), row);

  return {
    // ── General ──────────────────────────────────────────────────────────────────────────

    async updateProject(
      _actorId: string,
      input: z.output<typeof updateProjectInput>,
    ): Promise<void> {
      const [project] = await allInOrder([
        projectByKey(input.projectKey),
        checkUser(input.leadId),
        checkUser(input.defaultAssigneeId),
      ]);
      const rows = await db
        .update(projects)
        .set({
          name: input.name,
          description: input.description,
          leadId: input.leadId,
          defaultAssigneeId: input.defaultAssigneeId,
          sprintLengthDays: input.sprintLengthDays,
        })
        .where(and(eq(projects.id, project.id), isNull(projects.archivedAt)))
        .returning({ id: projects.id });
      if (rows.length === 0) throw notFound(`Project ${input.projectKey}`);
    },

    /** SPR-5: whether completing a sprint makes its retro doc. */
    async setAutoRetro(_actorId: string, input: z.output<typeof setAutoRetroInput>): Promise<void> {
      const rows = await db
        .update(projects)
        .set({ autoRetro: input.autoRetro })
        .where(and(eq(projects.key, input.projectKey), isNull(projects.archivedAt)))
        .returning({ id: projects.id });
      if (rows.length === 0) throw notFound(`Project ${input.projectKey}`);
    },

    /**
     * BRD-6 / VW-4: the board's and/or the issue list's default types and hidden statuses.
     * One statement under the workflow lock (so the statuses it checks cannot change
     * meanwhile): hidden ids are kept only if they are the project's statuses (stored in
     * workflow order), and every saved side must leave at least one status visible. Like
     * the other settings, no activity row.
     */
    async saveViewDefaults(
      _actorId: string,
      input: z.output<typeof saveViewDefaultsInput>,
    ): Promise<void> {
      const projectId = sql`(SELECT id FROM projects WHERE key = ${input.projectKey})`;
      const sets: SQL[] = [];
      const checks: SQL[] = [];
      const sides = [
        ["board", input.board],
        ["list", input.list],
      ] as const;
      for (const [side, value] of sides) {
        if (!value) continue;
        const types =
          value.issueTypes === null
            ? sql`NULL::issue_type[]`
            : sql`ARRAY[${sql.join(
                value.issueTypes.map((type) => sql`${type}`),
                sql`, `,
              )}]::issue_type[]`;
        const wanted = sql`ARRAY[${sql.join(
          value.hiddenStatusIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::uuid[]`;
        const hidden = sql`ARRAY(SELECT st.id FROM statuses st
          WHERE st.project_id = projects.id AND st.id = ANY(${wanted})
          ORDER BY st.position, st.created_at, st.id)`;
        sets.push(
          sql`${sql.identifier(`${side}_issue_types`)} = ${types}`,
          sql`${sql.identifier(`${side}_hidden_status_ids`)} = ${hidden}`,
        );
        checks.push(sql`EXISTS (SELECT 1 FROM statuses st
          WHERE st.project_id = projects.id AND NOT (st.id = ANY(${wanted})))`);
      }
      const results = await runAtomic([
        workflowLock(projectId),
        sql`
          WITH p AS (
            SELECT id FROM projects WHERE key = ${input.projectKey} AND archived_at IS NULL
          ),
          saved AS (
            UPDATE projects SET ${sql.join(sets, sql`, `)}, updated_at = now()
            FROM p WHERE projects.id = p.id AND ${sql.join(checks, sql` AND `)}
            RETURNING projects.id
          )
          SELECT EXISTS (SELECT 1 FROM p) AS found, EXISTS (SELECT 1 FROM saved) AS saved
        `,
      ]);
      const [row] = lastRows(results, z.object({ found: z.boolean(), saved: z.boolean() }));
      if (!row?.found) throw notFound(`Project ${input.projectKey}`);
      if (!row.saved) throw invalid(KEEP_ONE_VISIBLE_MESSAGE);
    },

    // ── Workflow ─────────────────────────────────────────────────────────────────────────

    /** Adds a status at the end of the board. Names are unique per project, any case. */
    async createStatus(
      _actorId: string,
      input: z.output<typeof createStatusInput>,
    ): Promise<{ id: string }> {
      const project = await projectByKey(input.projectKey);
      const projectId = sql`${project.id}::uuid`;
      const results = await uniquely(
        "statuses_project_name_unique",
        "A status with that name already exists",
        () =>
          runAtomic([
            workflowLock(projectId),
            sql`
              INSERT INTO statuses (project_id, name, category, position)
              SELECT ${projectId}, ${input.name}, ${input.category}::status_category,
                COALESCE((SELECT max(position) + 1 FROM statuses WHERE project_id = ${projectId}), 0)
              WHERE NOT EXISTS (SELECT 1 FROM statuses
                WHERE project_id = ${projectId} AND lower(name) = lower(${input.name}))
              RETURNING id::text
            `,
          ]),
      );
      const [row] = lastRows(results, z.object({ id: z.string() }));
      if (!row) throw conflict("A status with that name already exists");
      return row;
    },

    /**
     * "Won't Do" is recognised by name (it is excluded from velocity, SPR-4, and GH-3 never
     * closes into it), so it keeps its name, and no other status can take it.
     */
    async renameStatus(_actorId: string, input: z.output<typeof renameStatusInput>) {
      const status = await statusRow(input.statusId);
      if (status.name === input.name) return;
      if (status.name === WONT_DO_STATUS_NAME || input.name === WONT_DO_STATUS_NAME) {
        throw invalid(
          `“${WONT_DO_STATUS_NAME}” is excluded from velocity by its name, so it cannot be renamed or reused`,
        );
      }
      const projectId = projectOfStatus(status.id);
      const results = await uniquely(
        "statuses_project_name_unique",
        "A status with that name already exists",
        () =>
          runAtomic([
            workflowLock(projectId),
            sql`
              UPDATE statuses SET name = ${input.name}, updated_at = now()
              WHERE id = ${status.id}::uuid AND NOT EXISTS (SELECT 1 FROM statuses o
                WHERE o.project_id = statuses.project_id AND o.id <> statuses.id
                  AND lower(o.name) = lower(${input.name}))
              RETURNING id::text
            `,
          ]),
      );
      if (lastRows(results, z.object({ id: z.string() })).length === 0) {
        await statusRow(status.id);
        throw conflict("A status with that name already exists");
      }
    },

    /**
     * Changes a status's category (§4.4). Its issues follow at once: entering `done` sets
     * `resolved_at`, leaving it clears it, as a status change would. Every category keeps at
     * least one status, and a default status cannot become `done`. Each started sprint gets
     * a `status_category_changed` note, so its burndown and velocity count the status by the
     * category it had at the time (`burndown.ts`), not the new one.
     */
    async setStatusCategory(actorId: string, input: z.output<typeof setStatusCategoryInput>) {
      const status = await statusRow(input.statusId);
      if (status.category === input.category) return;
      const projectId = projectOfStatus(status.id);
      const results = await runAtomic([
        workflowLock(projectId),
        sql`
          WITH s AS (
            SELECT id, project_id, name, category AS old, is_default_for FROM statuses
            WHERE id = ${status.id}::uuid FOR UPDATE
          ),
          allowed AS (
            SELECT EXISTS (SELECT 1 FROM statuses o, s WHERE o.project_id = s.project_id
                AND o.category = s.old AND o.id <> s.id)
              AND (${input.category}::status_category <> 'done'
                OR (SELECT is_default_for FROM s) IS NULL) AS ok
          ),
          changed AS (
            UPDATE statuses SET category = ${input.category}::status_category, updated_at = now()
            FROM s WHERE statuses.id = s.id AND s.old <> ${input.category}::status_category
              AND (SELECT ok FROM allowed)
            RETURNING statuses.id
          ),
          resolved AS (
            UPDATE issues SET resolved_at = CASE
                WHEN ${input.category}::status_category = 'done'
                  THEN COALESCE(issues.resolved_at, now())
                ELSE NULL END,
              updated_at = now()
            FROM changed WHERE issues.status_id = changed.id
          ),
          -- SPR-3/4: past sprints keep counting the status by its old category.
          sprint_notes AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, meta)
            SELECT 'sprint', sp.id, ${actorId}::uuid, ${SPRINT_ACTIONS.statusCategoryChanged},
              jsonb_build_object('statusId', s.id, 'name', s.name, 'fromCategory', s.old,
                'category', ${input.category}::text)
            FROM sprints sp, s, changed
            WHERE sp.project_id = s.project_id AND sp.state <> 'planned'
          )
          SELECT (SELECT count(*)::int FROM changed) AS n
        `,
      ]);
      const [row] = lastRows(results, countRow);
      if (row && row.n > 0) return;
      const current = await statusRow(status.id);
      if (current.category === input.category) return;
      if (input.category === "done" && current.isDefaultFor) {
        throw invalid(
          `${current.name} is the default for ${DEFAULT_LABELS[current.isDefaultFor]}, which cannot start out done`,
        );
      }
      throw invalid(
        `Keep at least one status in “${CATEGORY_LABELS[current.category]}”; add another one first`,
      );
    },

    /**
     * Makes the status the default for new bugs or for everything else (§4.4). Exactly one
     * default per kind: the old default is cleared in the same transaction, right before the
     * new one is set (the partial unique index allows only one). A status is the default for
     * one kind at most, and never a done one.
     */
    async setStatusDefault(_actorId: string, input: z.output<typeof setStatusDefaultInput>) {
      const status = await statusRow(input.statusId);
      if (status.isDefaultFor === input.kind) return;
      const projectId = projectOfStatus(status.id);
      const kind = sql`${input.kind}::status_default_for`;
      // Checked by both statements (under the lock nothing changes in between), so either
      // both apply or neither does: a refused change never leaves a kind without a default.
      const eligible = sql`EXISTS (SELECT 1 FROM statuses t WHERE t.id = ${status.id}::uuid
        AND t.category <> 'done' AND (t.is_default_for IS NULL OR t.is_default_for = ${kind}))`;
      const results = await runAtomic([
        workflowLock(projectId),
        sql`
          UPDATE statuses SET is_default_for = NULL, updated_at = now()
          WHERE project_id = ${projectId} AND is_default_for = ${kind}
            AND id <> ${status.id}::uuid AND ${eligible}
        `,
        sql`
          UPDATE statuses SET is_default_for = ${kind}, updated_at = now()
          WHERE id = ${status.id}::uuid AND ${eligible}
          RETURNING id::text
        `,
      ]);
      if (lastRows(results, z.object({ id: z.string() })).length > 0) return;
      const current = await statusRow(status.id);
      if (current.category === "done") throw invalid("New issues cannot start in a done status");
      if (current.isDefaultFor && current.isDefaultFor !== input.kind) {
        throw invalid(
          `${current.name} is already the default for ${DEFAULT_LABELS[current.isDefaultFor]}; make another status that default first`,
        );
      }
    },

    /**
     * BRD-5: the column's WIP limit (null = none). Only the board reads it, and it spans one
     * status, so it is a plain UPDATE (no workflow lock).
     */
    async setStatusWipLimit(
      _actorId: string,
      input: z.output<typeof setStatusWipLimitInput>,
    ): Promise<void> {
      const rows = await db
        .update(statuses)
        .set({ wipLimit: input.wipLimit })
        .where(
          and(
            eq(statuses.id, input.statusId),
            // Archived projects are read-only, as for the general settings.
            sql`${statuses.projectId} IN (SELECT id FROM projects WHERE archived_at IS NULL)`,
          ),
        )
        .returning({ id: statuses.id });
      if (rows.length === 0) throw notFound("Status");
    },

    /**
     * Board order (`statuses.position`, plain integers): puts the status right after
     * `afterStatusId` (or first) and renumbers the project's statuses 0…n-1 in one
     * statement, under the workflow lock. Statuses are few, so renumbering all is cheap.
     */
    async moveStatus(_actorId: string, input: z.output<typeof moveStatusInput>) {
      const status = await statusRow(input.statusId);
      const projectId = projectOfStatus(status.id);
      const after = input.afterStatusId;
      const results = await runAtomic([
        workflowLock(projectId),
        sql`
          WITH others AS (
            SELECT id, row_number() OVER (ORDER BY position, created_at, id) AS rn
            FROM statuses
            WHERE project_id = ${projectId} AND id <> ${status.id}::uuid
          ),
          anchor AS (
            SELECT COALESCE((SELECT rn FROM others WHERE id = ${uuidOrNull(after)}), 0) AS rn
          ),
          valid AS (
            SELECT ${uuidOrNull(after)} IS NULL
              OR EXISTS (SELECT 1 FROM others WHERE id = ${uuidOrNull(after)}) AS ok
          ),
          plan AS (
            SELECT id, CASE WHEN rn <= (SELECT rn FROM anchor) THEN rn ELSE rn + 1 END AS pos
            FROM others
            UNION ALL
            SELECT ${status.id}::uuid, (SELECT rn FROM anchor) + 1
          ),
          moved AS (
            UPDATE statuses SET position = plan.pos - 1, updated_at = now()
            FROM plan
            WHERE statuses.id = plan.id AND (SELECT ok FROM valid)
              AND statuses.position <> plan.pos - 1
            RETURNING statuses.id
          )
          SELECT (SELECT ok FROM valid) AS ok
        `,
      ]);
      const [row] = lastRows(results, z.object({ ok: z.boolean() }));
      if (!row?.ok) throw notFound("Status to move after");
    },

    /**
     * Deletes a status. Unused: just deleted. Used: its issues (trashed ones too, which keep
     * their status for a restore) move to `moveToStatusId` with one `status` activity row
     * each, in the same statement as the delete, so a failure changes nothing. Refused when
     * it would leave its category empty or it is a default (make another one the default).
     *
     * SPR-3/4 replay status changes against the project's statuses; a deleted one would be
     * unknown there, so each started sprint gets a `status_deleted` row with its name and
     * category (`sprint-queries.ts` reads them), and the burndowns keep counting it right.
     */
    async deleteStatus(
      actorId: string,
      input: z.output<typeof deleteStatusInput>,
    ): Promise<{ moved: number }> {
      const status = await statusRow(input.statusId);
      if (status.isDefaultFor) {
        throw invalid(
          `${status.name} is the default for ${DEFAULT_LABELS[status.isDefaultFor]}; make another status that default first`,
        );
      }
      const projectId = projectOfStatus(status.id);
      const target = uuidOrNull(input.moveToStatusId);
      const results = await runAtomic([
        workflowLock(projectId),
        sql`SELECT id FROM statuses WHERE id = ${status.id}::uuid FOR UPDATE`,
        sql`
          WITH s AS (
            SELECT id, project_id, name, category, is_default_for FROM statuses
            WHERE id = ${status.id}::uuid
          ),
          target AS (
            SELECT t.id, t.category FROM statuses t, s
            WHERE t.id = ${target} AND t.project_id = s.project_id AND t.id <> s.id
          ),
          used AS (SELECT count(*)::int AS n FROM issues i, s WHERE i.status_id = s.id),
          allowed AS (
            SELECT EXISTS (SELECT 1 FROM s)
              AND (SELECT is_default_for FROM s) IS NULL
              AND EXISTS (SELECT 1 FROM statuses o, s WHERE o.project_id = s.project_id
                AND o.category = s.category AND o.id <> s.id)
              AND ((SELECT n FROM used) = 0 OR EXISTS (SELECT 1 FROM target)) AS ok
          ),
          moved AS (
            UPDATE issues SET status_id = target.id,
              resolved_at = CASE WHEN target.category = 'done'
                THEN COALESCE(issues.resolved_at, now()) ELSE NULL END,
              updated_at = now()
            FROM s, target
            WHERE issues.status_id = s.id AND (SELECT ok FROM allowed)
            RETURNING issues.id
          ),
          move_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
              to_value, meta)
            SELECT 'issue', moved.id, ${actorId}::uuid, 'updated', 'status', s.id::text,
              target.id::text,
              jsonb_build_object('reason', 'status_deleted', 'fromName', s.name)
            FROM moved, s, target
          ),
          sprint_notes AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, meta)
            SELECT 'sprint', sp.id, ${actorId}::uuid, ${SPRINT_ACTIONS.statusDeleted},
              jsonb_build_object('statusId', s.id, 'name', s.name, 'category', s.category)
            FROM sprints sp, s
            WHERE sp.project_id = s.project_id AND sp.state <> 'planned'
              AND (SELECT ok FROM allowed)
          ),
          -- BRD-6 / VW-4: the deleted status leaves the board's and the list's hidden sets.
          unhidden AS (
            UPDATE projects SET
              board_hidden_status_ids = array_remove(projects.board_hidden_status_ids, s.id),
              list_hidden_status_ids = array_remove(projects.list_hidden_status_ids, s.id),
              updated_at = now()
            FROM s
            WHERE projects.id = s.project_id AND (SELECT ok FROM allowed)
              AND (s.id = ANY(projects.board_hidden_status_ids)
                OR s.id = ANY(projects.list_hidden_status_ids))
          ),
          deleted AS (
            DELETE FROM statuses WHERE id IN (SELECT id FROM s) AND (SELECT ok FROM allowed)
            RETURNING id
          )
          SELECT (SELECT count(*)::int FROM deleted) AS deleted,
            (SELECT count(*)::int FROM moved) AS moved,
            (SELECT n FROM used) AS used,
            EXISTS (SELECT 1 FROM target) AS has_target
        `,
      ]);
      const [row] = lastRows(
        results,
        z.object({
          deleted: z.number(),
          moved: z.number(),
          used: z.number().nullable(),
          has_target: z.boolean(),
        }),
      );
      if (row && row.deleted > 0) return { moved: row.moved };
      const current = await statusRow(status.id);
      if (current.isDefaultFor) {
        throw invalid(
          `${current.name} is the default for ${DEFAULT_LABELS[current.isDefaultFor]}; make another status that default first`,
        );
      }
      if (row && (row.used ?? 0) > 0 && !row.has_target) {
        throw invalid(
          input.moveToStatusId
            ? "Status to move the issues to not found"
            : `${row.used} ${row.used === 1 ? "issue uses" : "issues use"} this status; pick a status to move ${row.used === 1 ? "it" : "them"} to`,
        );
      }
      throw invalid(
        `Keep at least one status in “${CATEGORY_LABELS[current.category]}”; add another one first`,
      );
    },

    // ── Labels ───────────────────────────────────────────────────────────────────────────

    async createLabel(
      _actorId: string,
      input: z.output<typeof createLabelInput>,
    ): Promise<{ id: string }> {
      const project = await projectByKey(input.projectKey);
      const result = await db.execute(sql`
        INSERT INTO labels (project_id, name, color)
        VALUES (${project.id}::uuid, ${input.name}, ${input.color})
        ON CONFLICT (project_id, name) DO NOTHING
        RETURNING id::text
      `);
      const [row] = rowsOf(result, z.object({ id: z.string() }));
      if (!row) throw conflict("A label with that name already exists");
      return row;
    },

    async renameLabel(_actorId: string, input: z.output<typeof renameLabelInput>) {
      const result = await uniquely(
        "labels_project_name_unique",
        "A label with that name already exists",
        () =>
          db.execute(sql`
            UPDATE labels SET name = ${input.name}, updated_at = now()
            WHERE id = ${input.labelId}::uuid RETURNING id
          `),
      );
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) throw notFound("Label");
    },

    async setLabelColor(_actorId: string, input: z.output<typeof setLabelColorInput>) {
      const result = await db.execute(sql`
        UPDATE labels SET color = ${input.color}, updated_at = now()
        WHERE id = ${input.labelId}::uuid RETURNING id
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) throw notFound("Label");
    },

    /** Deletes a label; every issue that had it gets a `label_removed` activity row. */
    async deleteLabel(actorId: string, labelId: string): Promise<{ detached: number }> {
      const results = await runAtomic([
        sql`SELECT id FROM labels WHERE id = ${labelId}::uuid FOR UPDATE`,
        sql`
          WITH l AS (SELECT id, name FROM labels WHERE id = ${labelId}::uuid),
          detached AS (
            DELETE FROM issue_labels il USING l WHERE il.label_id = l.id
            RETURNING il.issue_id
          ),
          detach_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
              meta)
            SELECT 'issue', d.issue_id, ${actorId}::uuid, 'label_removed', 'labels', l.id::text,
              jsonb_build_object('name', l.name, 'reason', 'label_deleted')
            FROM detached d, l
          ),
          gone AS (DELETE FROM labels WHERE id IN (SELECT id FROM l) RETURNING id)
          SELECT (SELECT count(*)::int FROM gone) AS gone,
            (SELECT count(*)::int FROM detached) AS detached
        `,
      ]);
      const [row] = lastRows(results, z.object({ gone: z.number(), detached: z.number() }));
      if (!row || row.gone === 0) throw notFound("Label");
      return { detached: row.detached };
    },

    // ── Components ───────────────────────────────────────────────────────────────────────

    async createComponent(
      _actorId: string,
      input: z.output<typeof createComponentInput>,
    ): Promise<{ id: string }> {
      const project = await projectByKey(input.projectKey);
      const result = await uniquely(
        "components_project_name_unique",
        "A component with that name already exists",
        () =>
          db.execute(sql`
            INSERT INTO components (project_id, name, github_repo)
            SELECT ${project.id}::uuid, ${input.name}, ${input.githubRepo}
            WHERE NOT EXISTS (SELECT 1 FROM components
              WHERE project_id = ${project.id}::uuid AND lower(name) = lower(${input.name}))
            RETURNING id::text
          `),
      );
      const [row] = rowsOf(result, z.object({ id: z.string() }));
      if (!row) throw conflict("A component with that name already exists");
      return row;
    },

    async renameComponent(_actorId: string, input: z.output<typeof renameComponentInput>) {
      const result = await uniquely(
        "components_project_name_unique",
        "A component with that name already exists",
        () =>
          db.execute(sql`
            UPDATE components SET name = ${input.name}, updated_at = now()
            WHERE id = ${input.componentId}::uuid AND NOT EXISTS (SELECT 1 FROM components o
              WHERE o.project_id = components.project_id AND o.id <> components.id
                AND lower(o.name) = lower(${input.name}))
            RETURNING id
          `),
      );
      if (rowsOf(result, z.object({ id: z.string() })).length > 0) return;
      const [exists] = await db
        .select({ id: components.id })
        .from(components)
        .where(eq(components.id, input.componentId))
        .limit(1);
      if (!exists) throw notFound("Component");
      throw conflict("A component with that name already exists");
    },

    async setComponentRepo(_actorId: string, input: z.output<typeof setComponentRepoInput>) {
      const result = await db.execute(sql`
        UPDATE components SET github_repo = ${input.githubRepo}, updated_at = now()
        WHERE id = ${input.componentId}::uuid RETURNING id
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) {
        throw notFound("Component");
      }
    },

    /**
     * Deletes a component; its issues (trashed ones too) lose it, each with a `component`
     * activity row, in the same transaction.
     */
    async deleteComponent(actorId: string, componentId: string): Promise<{ unset: number }> {
      const results = await runAtomic([
        sql`SELECT id FROM components WHERE id = ${componentId}::uuid FOR UPDATE`,
        sql`
          WITH c AS (SELECT id, name FROM components WHERE id = ${componentId}::uuid),
          unset AS (
            UPDATE issues SET component_id = NULL, updated_at = now()
            FROM c WHERE issues.component_id = c.id
            RETURNING issues.id
          ),
          unset_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
              to_value, meta)
            SELECT 'issue', u.id, ${actorId}::uuid, 'updated', 'component', c.id::text, NULL,
              jsonb_build_object('reason', 'component_deleted', 'fromName', c.name)
            FROM unset u, c
          ),
          gone AS (DELETE FROM components WHERE id IN (SELECT id FROM c) RETURNING id)
          SELECT (SELECT count(*)::int FROM gone) AS gone,
            (SELECT count(*)::int FROM unset) AS unset
        `,
      ]);
      const [row] = lastRows(results, z.object({ gone: z.number(), unset: z.number() }));
      if (!row || row.gone === 0) throw notFound("Component");
      return { unset: row.unset };
    },
  };
}

export type ProjectSettingsService = ReturnType<typeof createProjectSettingsService>;
