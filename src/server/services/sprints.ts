import { sql } from "drizzle-orm";
import { z } from "zod";

import { SPRINT_ACTIONS, WONT_DO_STATUS_NAME } from "@/lib/sprints/constants";
import {
  type completeSprintInput,
  type createSprintInput,
  type updateSprintInput,
} from "@/lib/sprints/schemas";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";

import { conflict, invalid, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";
import { createSprintRetroService, type EnsuredRetro } from "./sprint-retros";
import { rowsOf } from "./sql";

export type CreateSprintData = z.output<typeof createSprintInput>;
export type UpdateSprintData = z.output<typeof updateSprintInput>;
export type CompleteSprintData = z.output<typeof completeSprintInput>;

export interface CompletedSprint {
  /** Open issues moved out of the sprint. */
  carried: number;
  /** Where they went: a planned sprint, or null for the backlog. */
  targetSprintId: string | null;
  completedPoints: number;
  /** SPR-5: the retro doc made because the project has `auto_retro` on, else null. */
  retroDocId: string | null;
}

export interface SprintServiceOptions {
  /** The completion's statements run in one transaction (see `RunAtomic`). */
  runAtomic: RunAtomic;
  read?: Read;
}

const stateRow = z.object({ state: z.string().nullable() });

/** The unique index that enforces SPR-1 "one active sprint per project". */
const ONE_ACTIVE = "sprints_one_active_per_project";

/** Guard for the `sprints` row writes: archived projects are read-only. */
const liveProject = sql`AND project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)`;

/**
 * Sprint lifecycle (SPR-1, SPR-2). Every write is one statement (or, for the completion,
 * one transaction) that also appends its `activity` rows: issue sprint changes as
 * `updated`/`sprint` (from → to sprint id, what the burndown replays) and the sprint's own
 * events on `entity_type = 'sprint'`.
 */
export function createSprintService(db: AppDatabase, options: SprintServiceOptions) {
  const read = options.read ?? directRead;
  const retros = createSprintRetroService(db, options);

  /** Why a guarded write changed nothing: the sprint's current state (null = no sprint). */
  async function currentState(sprintId: string): Promise<string | null> {
    const [row] = rowsOf(
      await read(
        db.execute(sql`SELECT state::text AS state FROM sprints WHERE id = ${sprintId}::uuid`),
      ),
      stateRow,
    );
    return row?.state ?? null;
  }

  function stateError(state: string | null, verb: string, wanted: string) {
    if (state === null) return notFound("Sprint");
    return invalid(`Only ${wanted} sprints can be ${verb}; this one is ${state}`);
  }

  return {
    async createSprint(actorId: string, input: CreateSprintData): Promise<{ id: string }> {
      const result = await db.execute(sql`
        WITH project AS (
          SELECT id FROM projects WHERE key = ${input.projectKey} AND archived_at IS NULL
        ),
        inserted AS (
          INSERT INTO sprints (project_id, name, goal, start_date, end_date)
          SELECT id, ${input.name}, ${input.goal}, ${input.startDate}::date, ${input.endDate}::date
          FROM project
          RETURNING id, name
        ),
        logged AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, meta)
          SELECT 'sprint', id, ${actorId}::uuid, ${SPRINT_ACTIONS.created},
            jsonb_build_object('name', name)
          FROM inserted
        )
        SELECT id FROM inserted
      `);
      const [row] = rowsOf(result, z.object({ id: z.string() }));
      if (!row) throw notFound(`Project ${input.projectKey}`);
      return { id: row.id };
    },

    /** Planned sprints only: an active or closed sprint's dates feed its burndown. */
    async updateSprint(actorId: string, input: UpdateSprintData): Promise<void> {
      const result = await db.execute(sql`
        WITH updated AS (
          UPDATE sprints SET name = ${input.name}, goal = ${input.goal},
            start_date = ${input.startDate}::date, end_date = ${input.endDate}::date,
            updated_at = now()
          WHERE id = ${input.sprintId}::uuid AND state = 'planned' ${liveProject}
          RETURNING id
        ),
        logged AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, meta)
          SELECT 'sprint', id, ${actorId}::uuid, ${SPRINT_ACTIONS.updated},
            jsonb_build_object('name', ${input.name}::text, 'goal', ${input.goal}::text,
              'startDate', ${input.startDate}::text, 'endDate', ${input.endDate}::text)
          FROM updated
        )
        SELECT count(*)::int AS updated FROM updated
      `);
      const [row] = rowsOf(result, z.object({ updated: z.number() }));
      if (!row || row.updated === 0) {
        throw stateError(await currentState(input.sprintId), "edited", "planned");
      }
    },

    /**
     * Deletes a planned sprint; its issues (done ones included) go back to the backlog,
     * each with its own activity row. The sprint row is locked first, so a concurrent start
     * either wins (and this deletes nothing) or waits for the delete.
     */
    async deleteSprint(actorId: string, sprintId: string): Promise<{ moved: number }> {
      const result = await db.execute(sql`
        WITH target AS (
          SELECT id, name FROM sprints
          WHERE id = ${sprintId}::uuid AND state = 'planned' ${liveProject}
          FOR UPDATE
        ),
        moved AS (
          UPDATE issues SET sprint_id = NULL, updated_at = now()
          WHERE sprint_id IN (SELECT id FROM target)
          RETURNING id, deleted_at
        ),
        moved_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value)
          SELECT 'issue', id, ${actorId}::uuid, 'updated', 'sprint', ${sprintId}::text, NULL
          FROM moved
        ),
        deleted AS (
          DELETE FROM sprints WHERE id IN (SELECT id FROM target) RETURNING id
        ),
        logged AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, meta)
          SELECT 'sprint', t.id, ${actorId}::uuid, ${SPRINT_ACTIONS.deleted},
            jsonb_build_object('name', t.name,
              'issueIds', COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM moved), '[]'::jsonb))
          FROM target t
        )
        SELECT (SELECT count(*)::int FROM deleted) AS deleted,
          (SELECT count(*)::int FROM moved WHERE deleted_at IS NULL) AS moved
      `);
      const [row] = rowsOf(result, z.object({ deleted: z.number(), moved: z.number() }));
      if (!row || row.deleted === 0) {
        throw stateError(await currentState(sprintId), "deleted", "planned");
      }
      return { moved: row.moved };
    },

    /**
     * SPR-1 start. The partial unique index allows one active sprint per project, so a
     * second start (even a concurrent one) fails on it; that is mapped to a clear message.
     * `sprint_started.meta` is the burndown's start snapshot: `committedPoints` and
     * `issueIds` for the open (not done-category) live issues, `memberIds` for all of them.
     */
    async startSprint(
      actorId: string,
      sprintId: string,
    ): Promise<{ committedPoints: number; issueIds: string[] }> {
      // Two statements in one transaction: the first takes the sprint's row lock (moves into
      // the sprint hold a share lock on it, see `planning.moveIssueToSprint`), so the second
      // reads the members AFTER every racing move in committed. A move out is not ordered
      // against it; the burndown replays sprint changes, so it still lands right.
      const start = sql`
        UPDATE sprints SET state = 'active', updated_at = now()
        WHERE id = ${sprintId}::uuid AND state = 'planned'
          AND start_date IS NOT NULL AND end_date IS NOT NULL ${liveProject}
        RETURNING id
      `;
      const snapshot = sql`
        WITH started AS (
          SELECT id FROM sprints
          WHERE id = ${sprintId}::uuid AND state = 'active' AND updated_at = now()
        ),
        members AS (
          SELECT i.id, COALESCE(i.story_points, 0) AS points, st.category <> 'done' AS open
          FROM issues i JOIN statuses st ON st.id = i.status_id
          WHERE i.sprint_id = ${sprintId}::uuid AND i.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM started)
        ),
        logged AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, meta)
          SELECT 'sprint', id, ${actorId}::uuid, ${SPRINT_ACTIONS.started},
            jsonb_build_object(
              'committedPoints',
                (SELECT COALESCE(sum(points), 0)::int FROM members WHERE open),
              'issueIds',
                COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM members WHERE open), '[]'::jsonb),
              'memberIds',
                COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM members), '[]'::jsonb))
          FROM started
          RETURNING meta
        )
        SELECT meta FROM logged
      `;
      let results: unknown[];
      try {
        results = await options.runAtomic([start, snapshot]);
      } catch (error) {
        const info = pgErrorInfo(error);
        if (info?.code === UNIQUE_VIOLATION && info.constraint === ONE_ACTIVE) {
          throw conflict("Another sprint is already active; complete it before starting this one");
        }
        throw error;
      }
      const [row] = rowsOf(
        results.at(-1),
        z.object({
          meta: z.object({ committedPoints: z.number(), issueIds: z.array(z.string()) }),
        }),
      );
      if (!row) {
        const state = await currentState(sprintId);
        if (state === "planned") throw invalid("Give the sprint a start and end date first");
        throw stateError(state, "started", "planned");
      }
      return { committedPoints: row.meta.committedPoints, issueIds: row.meta.issueIds };
    },

    /**
     * SPR-2 completion, atomically (one transaction of three statements, each seeing the
     * previous ones):
     *
     * 1. close the sprint (`state = 'closed'`, `closed_at = now()`); it must be active.
     *    Later statements act only if THIS transaction closed it (`closed_at = now()`, the
     *    transaction's start time), so a lost race changes nothing;
     * 2. carry to "next": if open issues remain and the project has no planned sprint,
     *    create one ("Sprint N", starting the day after the latest sprint ends, the
     *    project's sprint length long);
     * 3. move the open live issues to the earliest planned sprint (or the backlog), one
     *    activity row each, and log `sprint_completed` with the Done points (Won't Do
     *    excluded) and the carried issue ids.
     */
    async completeSprint(actorId: string, input: CompleteSprintData): Promise<CompletedSprint> {
      const id = input.sprintId;
      const closedHere = sql`id = ${id}::uuid AND state = 'closed' AND closed_at = now()`;
      const close = sql`
        UPDATE sprints SET state = 'closed', closed_at = now(), updated_at = now()
        WHERE id = ${id}::uuid AND state = 'active' ${liveProject}
        RETURNING id
      `;
      const createNext = sql`
        WITH closed AS (SELECT project_id FROM sprints WHERE ${closedHere}),
        settings AS (
          SELECT c.project_id, p.sprint_length_days AS length,
            COALESCE((SELECT max(end_date) FROM sprints s WHERE s.project_id = c.project_id) + 1,
              current_date) AS start_date,
            (SELECT count(*) FROM sprints s WHERE s.project_id = c.project_id) + 1 AS number
          FROM closed c JOIN projects p ON p.id = c.project_id
          WHERE NOT EXISTS (
            SELECT 1 FROM sprints s WHERE s.project_id = c.project_id AND s.state = 'planned'
          )
          -- Only when there is something to carry.
          AND EXISTS (
            SELECT 1 FROM issues i JOIN statuses st ON st.id = i.status_id
            WHERE i.sprint_id = ${id}::uuid AND i.deleted_at IS NULL AND st.category <> 'done'
          )
        ),
        inserted AS (
          INSERT INTO sprints (project_id, name, start_date, end_date)
          SELECT project_id, 'Sprint ' || number, start_date,
            start_date + (GREATEST(length, 1) - 1)
          FROM settings
          RETURNING id, name
        )
        INSERT INTO activity (entity_type, entity_id, actor_id, action, meta)
        SELECT 'sprint', id, ${actorId}::uuid, ${SPRINT_ACTIONS.created},
          jsonb_build_object('name', name, 'createdBy', 'completion')
        FROM inserted
      `;
      const carry = sql`
        WITH closed AS (SELECT id, project_id FROM sprints WHERE ${closedHere}),
        target AS (
          SELECT s.id FROM sprints s JOIN closed c ON c.project_id = s.project_id
          WHERE ${input.carryTo}::text = 'next' AND s.state = 'planned'
          ORDER BY s.start_date NULLS LAST, s.created_at, s.id
          LIMIT 1
        ),
        open_issues AS (
          SELECT i.id FROM issues i JOIN statuses st ON st.id = i.status_id
          WHERE i.sprint_id IN (SELECT id FROM closed) AND i.deleted_at IS NULL
            AND st.category <> 'done'
          FOR UPDATE OF i
        ),
        moved AS (
          UPDATE issues SET sprint_id = (SELECT id FROM target), updated_at = now()
          WHERE id IN (SELECT id FROM open_issues)
          RETURNING id, sprint_id
        ),
        moved_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value)
          SELECT 'issue', id, ${actorId}::uuid, 'updated', 'sprint', ${id}::text,
            sprint_id::text
          FROM moved
        ),
        completed AS (
          SELECT COALESCE(sum(i.story_points), 0)::int AS points,
            COALESCE(jsonb_agg(i.id ORDER BY i.id), '[]'::jsonb) AS ids
          FROM issues i JOIN statuses st ON st.id = i.status_id
          WHERE i.sprint_id IN (SELECT id FROM closed) AND i.deleted_at IS NULL
            AND st.category = 'done' AND st.name <> ${WONT_DO_STATUS_NAME}
        ),
        logged AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, meta)
          SELECT 'sprint', c.id, ${actorId}::uuid, ${SPRINT_ACTIONS.completed},
            jsonb_build_object(
              'completedPoints', (SELECT points FROM completed),
              -- SPR-5: what the retro lists as completed, even when made later.
              'completedIssueIds', (SELECT ids FROM completed),
              'carriedIssueIds', COALESCE((SELECT jsonb_agg(id ORDER BY id) FROM moved),
                '[]'::jsonb),
              'carriedTo', (SELECT id FROM target))
          FROM closed c
        )
        SELECT (SELECT count(*)::int FROM moved) AS carried,
          (SELECT id::text FROM target) AS target_sprint_id,
          (SELECT points FROM completed) AS completed_points,
          EXISTS (SELECT 1 FROM closed) AS closed
      `;
      const statements: [typeof close, ...(typeof close)[]] =
        input.carryTo === "next" ? [close, createNext, carry] : [close, carry];
      const results = await options.runAtomic(statements);
      const [row] = rowsOf(
        results.at(-1),
        z.object({
          carried: z.number(),
          target_sprint_id: z.string().nullable(),
          completed_points: z.number(),
          closed: z.boolean(),
        }),
      );
      if (!row?.closed) throw stateError(await currentState(id), "completed", "active");
      // SPR-5: right after the completion (see `createSprintRetroService` for why not in
      // it). A failure here must not report the completion, which did happen, as failed:
      // it is logged, and the sprint page offers "Create retro".
      let retroDocId: string | null = null;
      try {
        retroDocId =
          (await retros.ensureRetro(actorId, id, { onlyIfEnabled: true }))?.docId ?? null;
      } catch (error) {
        console.error(
          `[retro] sprint ${id}: auto retro failed:`,
          error instanceof Error ? error.message : error,
        );
      }
      return {
        carried: row.carried,
        targetSprintId: row.target_sprint_id,
        completedPoints: row.completed_points,
        retroDocId,
      };
    },

    /** SPR-5 "Create retro" for a sprint completed without one (or whose retro was deleted). */
    createRetro(actorId: string, sprintId: string): Promise<EnsuredRetro> {
      return retros.ensureRetro(actorId, sprintId).then((retro) => {
        // Never null without `onlyIfEnabled`; checked for the type.
        if (!retro) throw invalid("Could not create the retro");
        return retro;
      });
    },
  };
}

export type SprintService = ReturnType<typeof createSprintService>;
