import { sql } from "drizzle-orm";
import { z } from "zod";

import { formatIssueKey } from "@/lib/issues/keys";
import { STATUS_CATEGORIES } from "@/lib/issues/constants";
import { ASSIGNEE_ME, ASSIGNEE_NONE } from "@/lib/issues/filters";
import { type RoadmapFilters } from "@/lib/roadmap/filters";
import { type RoadmapDependency, type RoadmapEpic } from "@/lib/roadmap/views";
import { WONT_DO_STATUS_NAME } from "@/lib/sprints/constants";
import { directRead } from "@/server/db/read-batch";
import { type AppDatabase } from "@/server/db/types";

import { type QueryOptions } from "./issue-queries";
import { type IdRef, rowsOf } from "./sql";

/**
 * Read side of the roadmap (RDM-1/RDM-2). Like every page query, each is ONE statement that
 * takes the project as an `IdRef`, so the page sends them in one batch (one round trip).
 * Dates are read as `::text` (ISO), so node-postgres and Neon return the same shapes.
 */

/** More epics than this is not a roadmap; the timeline would be unreadable anyway. */
export const ROADMAP_EPIC_LIMIT = 500;

const epicRow = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  project_key: z.string(),
  status_id: z.string(),
  status_name: z.string(),
  status_category: z.enum(STATUS_CATEGORIES),
  assignee_id: z.string().nullable(),
  assignee_name: z.string().nullable(),
  component_id: z.string().nullable(),
  component_name: z.string().nullable(),
  start_date: z.string().nullable(),
  due_date: z.string().nullable(),
  total: z.number(),
  done: z.number(),
  wont_do: z.number(),
  points: z.number(),
  done_points: z.number(),
  pointed: z.number(),
});

const dependencyRow = z.object({
  link_id: z.string(),
  blocker_id: z.string(),
  blocked_id: z.string(),
});

/** A jsonb array parameter, unpacked as a set of text values. */
const textSet = (values: readonly string[]) =>
  sql`(SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;

export function createRoadmapQueries(db: AppDatabase, { read = directRead }: QueryOptions = {}) {
  return {
    /**
     * The project's live epics with their status, assignee, component, dates and the tally
     * of their live direct children (for `epicProgress`), filtered by the epic's component,
     * assignee (`me` = `currentUserId`, `none` = unassigned) and status category.
     */
    async listEpics(
      projectId: IdRef,
      filters: RoadmapFilters,
      currentUserId: string,
    ): Promise<RoadmapEpic[]> {
      const conditions = [sql`TRUE`];
      if (filters.components.length > 0) {
        conditions.push(sql`e.component_id::text IN ${textSet(filters.components)}`);
      }
      if (filters.assignees.length > 0) {
        const ids = filters.assignees
          .filter((value) => value !== ASSIGNEE_NONE)
          .map((value) => (value === ASSIGNEE_ME ? currentUserId : value));
        const unassigned = filters.assignees.includes(ASSIGNEE_NONE);
        conditions.push(
          sql`(e.assignee_id::text IN ${textSet(ids)} ${unassigned ? sql`OR e.assignee_id IS NULL` : sql``})`,
        );
      }
      if (filters.categories.length > 0) {
        conditions.push(sql`st.category::text IN ${textSet(filters.categories)}`);
      }
      const wontDo = sql`(cs.category = 'done' AND cs.name = ${WONT_DO_STATUS_NAME})`;
      const done = sql`(cs.category = 'done' AND cs.name <> ${WONT_DO_STATUS_NAME})`;
      const result = await read(
        db.execute(sql`
          SELECT e.id, e.number, e.title, p.key AS project_key,
            st.id AS status_id, st.name AS status_name, st.category::text AS status_category,
            a.id AS assignee_id, a.name AS assignee_name,
            c.id AS component_id, c.name AS component_name,
            e.start_date::text AS start_date, e.due_date::text AS due_date,
            t.total, t.done, t.wont_do, t.points, t.done_points, t.pointed
          FROM issues e
          JOIN projects p ON p.id = e.project_id
          JOIN statuses st ON st.id = e.status_id
          LEFT JOIN users a ON a.id = e.assignee_id
          LEFT JOIN components c ON c.id = e.component_id
          CROSS JOIN LATERAL (
            SELECT count(*)::int AS total,
              (count(*) FILTER (WHERE ${done}))::int AS done,
              (count(*) FILTER (WHERE ${wontDo}))::int AS wont_do,
              COALESCE(sum(ch.story_points) FILTER (WHERE NOT ${wontDo}), 0)::int AS points,
              COALESCE(sum(ch.story_points) FILTER (WHERE ${done}), 0)::int AS done_points,
              (count(ch.story_points) FILTER (WHERE NOT ${wontDo}))::int AS pointed
            FROM issues ch JOIN statuses cs ON cs.id = ch.status_id
            WHERE ch.parent_id = e.id AND ch.deleted_at IS NULL
          ) t
          WHERE e.project_id = ${projectId} AND e.type = 'epic' AND e.deleted_at IS NULL
            AND ${sql.join(conditions, sql` AND `)}
          ORDER BY e.start_date ASC NULLS LAST, e.due_date ASC NULLS LAST, e.number
          LIMIT ${ROADMAP_EPIC_LIMIT}
        `),
      );
      return rowsOf(result, epicRow).map((row) => ({
        id: row.id,
        key: formatIssueKey(row.project_key, row.number),
        number: row.number,
        title: row.title,
        status: { id: row.status_id, name: row.status_name, category: row.status_category },
        assignee:
          row.assignee_id && row.assignee_name !== null
            ? { id: row.assignee_id, name: row.assignee_name }
            : null,
        component:
          row.component_id && row.component_name !== null
            ? { id: row.component_id, name: row.component_name }
            : null,
        startDate: row.start_date,
        dueDate: row.due_date,
        children: {
          total: row.total,
          done: row.done,
          wontDo: row.wont_do,
          points: row.points,
          donePoints: row.done_points,
          pointed: row.pointed,
        },
      }));
    },

    /** RDM-2: `blocks` links between two live epics of the project (`source blocks target`). */
    async listDependencies(projectId: IdRef): Promise<RoadmapDependency[]> {
      const result = await read(
        db.execute(sql`
          SELECT l.id AS link_id, l.source_issue_id AS blocker_id, l.target_issue_id AS blocked_id
          FROM issue_links l
          JOIN issues s ON s.id = l.source_issue_id
          JOIN issues t ON t.id = l.target_issue_id
          WHERE l.type = 'blocks' AND s.project_id = ${projectId} AND t.project_id = s.project_id
            AND s.type = 'epic' AND t.type = 'epic'
            AND s.deleted_at IS NULL AND t.deleted_at IS NULL
          ORDER BY l.created_at, l.id
        `),
      );
      return rowsOf(result, dependencyRow).map((row) => ({
        linkId: row.link_id,
        blockerId: row.blocker_id,
        blockedId: row.blocked_id,
      }));
    },
  };
}

export type RoadmapQueries = ReturnType<typeof createRoadmapQueries>;
