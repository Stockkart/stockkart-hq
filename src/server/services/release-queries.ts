import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { ISSUE_TYPES, STATUS_CATEGORIES } from "@/lib/issues/constants";
import { formatIssueKey } from "@/lib/issues/keys";
import { RELEASE_STATES } from "@/lib/releases/constants";
import { type ReleaseIssue, type ReleaseOption, type ReleaseSummary } from "@/lib/releases/views";
import { directRead } from "@/server/db/read-batch";
import { type AppDatabase } from "@/server/db/types";

import { type QueryOptions } from "./issue-queries";
import { type IdRef, rowsOf } from "./sql";

/**
 * Read side for releases (REL-1/2). Like every page query, each one is a single statement
 * that takes the project as an `IdRef`, so a page sends them all in one batch (one round
 * trip). Instants are read as epoch milliseconds and dates as `::text`, so node-postgres
 * (tests) and Neon (app) return the same shapes.
 */

const tally = z.object({ count: z.number(), points: z.number() });
const summaryRow = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  release_date: z.string().nullable(),
  state: z.enum(RELEASE_STATES),
  released_ms: z.number().nullable(),
  notes_doc_id: z.string().nullable(),
  total: tally,
  done: tally,
});
const issueRow = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  type: z.enum(ISSUE_TYPES),
  story_points: z.number().nullable(),
  project_key: z.string(),
  status_id: z.string(),
  status_name: z.string(),
  status_category: z.enum(STATUS_CATEGORIES),
});
const optionRow = z.object({ id: z.string(), name: z.string(), state: z.enum(RELEASE_STATES) });

const epochMs = (column: SQL) => sql`floor(extract(epoch FROM ${column}) * 1000)::float8`;

/** REL-1 display order: unreleased by target date, then released ones, newest first. */
const RELEASE_ORDER = sql`r.state = 'released',
  CASE WHEN r.state = 'unreleased' THEN r.release_date END ASC NULLS LAST,
  r.released_at DESC NULLS LAST, r.name, r.id`;

/** Live issues with this fix version, counted (and points summed) with `condition`. */
const tallyOf = (condition: SQL) => sql`(
  SELECT json_build_object('count', count(*)::int,
    'points', COALESCE(sum(i.story_points), 0)::int)
  FROM issues i JOIN statuses st ON st.id = i.status_id
  WHERE i.release_id = r.id AND i.deleted_at IS NULL AND ${condition}
)`;

function toSummary(row: z.infer<typeof summaryRow>): ReleaseSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    releaseDate: row.release_date,
    state: row.state,
    releasedAt: row.released_ms === null ? null : new Date(row.released_ms),
    total: row.total,
    done: row.done,
    notesDocId: row.notes_doc_id,
  };
}

export function createReleaseQueries(db: AppDatabase, { read = directRead }: QueryOptions = {}) {
  const summarySelect = (where: SQL) => sql`
    SELECT r.id, r.name, r.description, r.release_date::text AS release_date,
      r.state::text AS state, ${epochMs(sql`r.released_at`)} AS released_ms,
      -- A trashed notes doc counts as none (AGENTS.md: set null only on a hard delete).
      (SELECT d.id::text FROM docs d WHERE d.id = r.notes_doc_id AND d.deleted_at IS NULL)
        AS notes_doc_id,
      ${tallyOf(sql`TRUE`)} AS total, ${tallyOf(sql`st.category = 'done'`)} AS done
    FROM releases r
    WHERE ${where}
    ORDER BY ${RELEASE_ORDER}
  `;

  return {
    /** REL-1 releases page: every release of the project with its progress. */
    async listReleases(projectId: IdRef): Promise<ReleaseSummary[]> {
      const result = await read(db.execute(summarySelect(sql`r.project_id = ${projectId}`)));
      return rowsOf(result, summaryRow).map(toSummary);
    },

    /** The live issues with this fix version (release page, REL-2 notes), by number. */
    async listReleaseIssues(projectId: IdRef, releaseId: string): Promise<ReleaseIssue[]> {
      const result = await read(
        db.execute(sql`
          SELECT i.id, i.number, i.title, i.type::text AS type, i.story_points,
            p.key AS project_key, st.id AS status_id, st.name AS status_name,
            st.category::text AS status_category
          FROM issues i
          JOIN projects p ON p.id = i.project_id
          JOIN statuses st ON st.id = i.status_id
          WHERE i.release_id = ${releaseId}::uuid AND i.project_id = ${projectId}
            AND i.deleted_at IS NULL
          ORDER BY i.number
        `),
      );
      return rowsOf(result, issueRow).map((row) => ({
        id: row.id,
        key: formatIssueKey(row.project_key, row.number),
        number: row.number,
        title: row.title,
        type: row.type,
        storyPoints: row.story_points,
        status: { id: row.status_id, name: row.status_name, category: row.status_category },
      }));
    },

    /** Fix-version options of a project (quick create loads them when it opens). */
    async releaseOptions(projectId: IdRef): Promise<ReleaseOption[]> {
      const result = await read(
        db.execute(sql`
          SELECT r.id, r.name, r.state::text AS state FROM releases r
          WHERE r.project_id = ${projectId}
          ORDER BY ${RELEASE_ORDER}
        `),
      );
      return rowsOf(result, optionRow);
    },
  };
}

export type ReleaseQueries = ReturnType<typeof createReleaseQueries>;
