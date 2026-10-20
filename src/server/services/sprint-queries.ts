import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { type BurndownData, type IssueChange, type SprintTimeline } from "@/lib/sprints/burndown";
import {
  SPRINT_ACTIONS,
  SPRINT_STATES,
  type StatusKind,
  statusKind,
  VELOCITY_SPRINTS,
  WONT_DO_STATUS_NAME,
} from "@/lib/sprints/constants";
import { type SprintOption, type SprintSummary } from "@/lib/sprints/views";
import { directRead } from "@/server/db/read-batch";
import { type AppDatabase } from "@/server/db/types";

import { type QueryOptions } from "./issue-queries";
import { type IdRef, rowsOf } from "./sql";

/**
 * Read side for sprints (SPR-1…4, BLG-3, BRD-3). Like every page query, each one is a single
 * statement that takes the project as an `IdRef`, so a page sends them all in one batch.
 *
 * Raw statements: dates are read as `::text` (ISO) and instants as epoch milliseconds, so
 * the node-postgres (tests) and Neon (app) drivers return the same shapes.
 */

const tally = z.object({ count: z.number(), points: z.number() });
const summaryRow = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  state: z.enum(SPRINT_STATES),
  closed_ms: z.number().nullable(),
  open: tally,
  done: tally,
  wont_do: tally,
});

const timelineRow = z.object({
  id: z.string(),
  name: z.string(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  closed_ms: z.number().nullable(),
  started_ms: z.number().nullable(),
  issue_ids: z.array(z.string()).nullable(),
});

const changeSchema = z.object({
  at: z.number(),
  field: z.enum(["sprint", "status", "storyPoints"]),
  from: z.string().nullable(),
  to: z.string().nullable(),
});
const issueRow = z.object({
  id: z.string(),
  created_ms: z.number(),
  deleted_ms: z.number().nullable(),
  sprint_id: z.string().nullable(),
  status_id: z.string(),
  story_points: z.number().nullable(),
  changes: z.array(changeSchema),
});

const statusRow = z.object({ id: z.string(), name: z.string(), category: z.string() });

/** Epoch milliseconds (floored), the same truncation for every instant compared. */
const epochMs = (column: SQL) => sql`floor(extract(epoch FROM ${column}) * 1000)::float8`;

/** Which sprints a burndown read covers: a scalar-free subquery of sprint ids. */
export type SprintTargets = SQL;

export function createSprintQueries(db: AppDatabase, { read = directRead }: QueryOptions = {}) {
  /** Live issues of a sprint counted by kind (open / Done / Won't Do). */
  const tallyOf = (kind: StatusKind) => {
    const condition =
      kind === "open"
        ? sql`st.category <> 'done'`
        : kind === "done"
          ? sql`st.category = 'done' AND st.name <> ${WONT_DO_STATUS_NAME}`
          : sql`st.category = 'done' AND st.name = ${WONT_DO_STATUS_NAME}`;
    return sql`(
      SELECT json_build_object('count', count(*)::int,
        'points', COALESCE(sum(i.story_points), 0)::int)
      FROM issues i JOIN statuses st ON st.id = i.status_id
      WHERE i.sprint_id = s.id AND i.deleted_at IS NULL AND ${condition}
    )`;
  };

  return {
    /**
     * Every sprint of the project with its issue tallies, in display order: the active one,
     * planned ones by start date, then closed ones, most recently closed first.
     */
    async listSprints(projectId: IdRef): Promise<SprintSummary[]> {
      const result = await read(
        db.execute(sql`
          SELECT s.id, s.name, s.goal, s.start_date::text AS start_date,
            s.end_date::text AS end_date, s.state::text AS state,
            ${epochMs(sql`s.closed_at`)} AS closed_ms,
            ${tallyOf("open")} AS open, ${tallyOf("done")} AS done,
            ${tallyOf("wont_do")} AS wont_do
          FROM sprints s
          WHERE s.project_id = ${projectId}
          ORDER BY CASE s.state WHEN 'active' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END,
            CASE WHEN s.state = 'planned' THEN s.start_date END ASC NULLS LAST,
            s.closed_at DESC NULLS LAST, s.created_at, s.id
        `),
      );
      return rowsOf(result, summaryRow).map((row) => ({
        id: row.id,
        name: row.name,
        goal: row.goal,
        startDate: row.start_date,
        endDate: row.end_date,
        state: row.state,
        closedAt: row.closed_ms === null ? null : new Date(row.closed_ms),
        open: row.open,
        done: row.done,
        wontDo: row.wont_do,
      }));
    },

    /** The project's active sprint (BRD-3 board scope), or null. */
    async getActiveSprint(projectId: IdRef): Promise<{ id: string; name: string } | null> {
      const result = await read(
        db.execute(sql`
          SELECT id, name FROM sprints WHERE project_id = ${projectId} AND state = 'active'
          LIMIT 1
        `),
      );
      const [row] = rowsOf(result, z.object({ id: z.string(), name: z.string() }));
      return row ?? null;
    },

    /**
     * Planned and active sprints of every project by key, for quick create (one statement;
     * the issue side panel gets its project's from `getProjectMeta`).
     */
    async openSprintOptionsByProject(): Promise<Record<string, SprintOption[]>> {
      const result = await read(
        db.execute(sql`
          SELECT p.key AS project_key, s.id, s.name, s.state::text AS state
          FROM sprints s JOIN projects p ON p.id = s.project_id
          WHERE s.state <> 'closed' AND p.archived_at IS NULL
          ORDER BY p.key, s.state = 'active' DESC, s.start_date ASC NULLS LAST, s.created_at,
            s.id
        `),
      );
      const rows = rowsOf(
        result,
        z.object({
          project_key: z.string(),
          id: z.string(),
          name: z.string(),
          state: z.enum(SPRINT_STATES),
        }),
      );
      const byProject: Record<string, SprintOption[]> = {};
      for (const row of rows) {
        (byProject[row.project_key] ??= []).push({ id: row.id, name: row.name, state: row.state });
      }
      return byProject;
    },

    /** The sprints page's burndown/velocity targets: the active sprint and the last closed. */
    activeAndRecentClosed(projectId: IdRef): SprintTargets {
      return sql`(
        SELECT id FROM sprints WHERE project_id = ${projectId} AND state = 'active'
        UNION ALL
        SELECT id FROM (
          SELECT id FROM sprints WHERE project_id = ${projectId} AND state = 'closed'
          ORDER BY closed_at DESC LIMIT ${VELOCITY_SPRINTS}
        ) recent
      )`;
    },

    /** One sprint of the project (the sprint page). */
    oneSprint(projectId: IdRef, sprintId: string): SprintTargets {
      return sql`(SELECT id FROM sprints WHERE id = ${sprintId}::uuid AND project_id = ${projectId})`;
    },

    /**
     * SPR-3/4 inputs for `targets`, in ONE round trip (three statements of the batch):
     * - each target's dates, close time and `sprint_started` row (time + issue snapshot);
     * - every issue that is, was or was snapshotted in a target, with its current values
     *   and its sprint/status/points changes;
     * - the project's statuses, for done / Won't Do.
     *
     * Finding issues by past sprint changes scans the project's `sprint` activity rows; the
     * team is small, so this stays cheap without an index on `from_value`/`to_value`.
     */
    async burndownInputs(
      projectId: IdRef,
      targets: SprintTargets,
    ): Promise<{ timelines: SprintTimeline[]; data: BurndownData }> {
      const [timelineResult, issueResult, statusResult] = await Promise.all([
        read(
          db.execute(sql`
            SELECT s.id, s.name, s.start_date::text AS start_date, s.end_date::text AS end_date,
              ${epochMs(sql`s.closed_at`)} AS closed_ms,
              ${epochMs(sql`started.created_at`)} AS started_ms,
              started.meta -> 'issueIds' AS issue_ids
            FROM sprints s
            LEFT JOIN LATERAL (
              SELECT a.created_at, a.meta FROM activity a
              WHERE a.entity_type = 'sprint' AND a.entity_id = s.id
                AND a.action = ${SPRINT_ACTIONS.started}
              ORDER BY a.created_at DESC
              LIMIT 1
            ) started ON TRUE
            WHERE s.id IN ${targets} AND s.project_id = ${projectId}
          `),
        ),
        read(
          db.execute(sql`
            WITH targets AS ${targets},
            universe AS (
              SELECT i.id FROM issues i WHERE i.sprint_id IN (SELECT id FROM targets)
              UNION
              SELECT a.entity_id FROM activity a
              WHERE a.entity_type = 'issue' AND a.field = 'sprint'
                AND (a.from_value IN (SELECT id::text FROM targets)
                  OR a.to_value IN (SELECT id::text FROM targets))
              UNION
              SELECT (jsonb_array_elements_text(a.meta -> 'issueIds'))::uuid FROM activity a
              WHERE a.entity_type = 'sprint' AND a.action = ${SPRINT_ACTIONS.started}
                AND a.entity_id IN (SELECT id FROM targets)
            )
            SELECT i.id, ${epochMs(sql`i.created_at`)} AS created_ms,
              ${epochMs(sql`i.deleted_at`)} AS deleted_ms, i.sprint_id, i.status_id,
              i.story_points,
              COALESCE((
                SELECT json_agg(json_build_object('at', ${epochMs(sql`a.created_at`)},
                  'field', a.field, 'from', a.from_value, 'to', a.to_value))
                FROM activity a
                WHERE a.entity_type = 'issue' AND a.entity_id = i.id AND a.action = 'updated'
                  AND a.field IN ('sprint', 'status', 'storyPoints')
              ), '[]'::json) AS changes
            FROM issues i
            WHERE i.id IN (SELECT id FROM universe) AND i.project_id = ${projectId}
          `),
        ),
        read(
          db.execute(sql`
            SELECT id, name, category::text AS category FROM statuses
            WHERE project_id = ${projectId}
          `),
        ),
      ]);

      const timelines: SprintTimeline[] = rowsOf(timelineResult, timelineRow).flatMap((row) =>
        row.start_date && row.end_date
          ? [
              {
                sprintId: row.id,
                name: row.name,
                startDate: row.start_date,
                endDate: row.end_date,
                startedAt: row.started_ms === null ? null : new Date(row.started_ms),
                closedAt: row.closed_ms === null ? null : new Date(row.closed_ms),
                snapshotIssueIds: row.issue_ids,
              },
            ]
          : [],
      );
      const issues = rowsOf(issueResult, issueRow);
      const changes: IssueChange[] = issues.flatMap((row) =>
        row.changes.map((change) => ({
          issueId: row.id,
          at: new Date(change.at),
          field: change.field,
          from: change.from,
          to: change.to,
        })),
      );
      return {
        timelines,
        data: {
          issues: issues.map((row) => ({
            id: row.id,
            createdAt: new Date(row.created_ms),
            deletedAt: row.deleted_ms === null ? null : new Date(row.deleted_ms),
            sprintId: row.sprint_id,
            statusId: row.status_id,
            points: row.story_points,
          })),
          changes,
          statusKinds: new Map(
            rowsOf(statusResult, statusRow).map((row) => [row.id, statusKind(row)]),
          ),
        },
      };
    },
  };
}

export type SprintQueries = ReturnType<typeof createSprintQueries>;
