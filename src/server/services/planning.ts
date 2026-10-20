import { sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import { type moveIssueInput, type recordViewInput } from "@/lib/planning/schemas";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase } from "@/server/db/types";

import { conflict, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";
import { rowsOf } from "./sql";

export type MoveIssueData = z.output<typeof moveIssueInput>;
export type RecordViewData = z.output<typeof recordViewInput>;

/** Attempts when concurrent moves keep landing on the same gap (see `moveIssue`). */
const RANK_ATTEMPTS = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface PlanningServiceOptions {
  /** How reads run; on Neon, reads started together share one round trip. */
  read?: Read;
  /** Test hook: runs between reading the neighbours and writing the new rank. */
  beforeRankWrite?: () => Promise<void>;
}

/** Backlog ordering (BLG-1) and My Work view tracking (MY-1). */
export function createPlanningService(db: AppDatabase, options: PlanningServiceOptions = {}) {
  const read = options.read ?? directRead;

  /**
   * Everything a move needs in ONE statement: the issue's rank, its predecessor's (null
   * for the top, or when `afterIssueId` is not a live issue of the same project) and the
   * predecessor's true successor among the project's other issues.
   */
  async function neighbours(issueId: string, afterIssueId: string | null) {
    const result = await read(
      db.execute(sql`
        SELECT i.rank AS current, p.rank AS prev, nx.rank AS next
        FROM issues i
        LEFT JOIN LATERAL (
          SELECT a.rank FROM issues a
          WHERE a.id = ${afterIssueId}::uuid AND a.project_id = i.project_id
            AND a.deleted_at IS NULL
        ) p ON TRUE
        LEFT JOIN LATERAL (
          SELECT n.rank FROM issues n
          WHERE n.project_id = i.project_id AND n.id <> i.id
            AND (p.rank IS NULL OR n.rank > p.rank)
          ORDER BY n.rank
          LIMIT 1
        ) nx ON TRUE
        WHERE i.id = ${issueId}::uuid AND i.deleted_at IS NULL
      `),
    );
    const [row] = rowsOf(
      result,
      z.object({ current: z.string(), prev: z.string().nullable(), next: z.string().nullable() }),
    );
    return row ?? null;
  }

  return {
    /**
     * BLG-1: moves one issue to just after `afterIssueId` (or to the top) by rewriting only
     * its own rank: a key between the predecessor and the predecessor's TRUE successor in
     * the project. The successor is read from the table, not taken from the client, because
     * hidden rows (done, filtered out, deleted: all keep their unique ranks) may sit between
     * two visible neighbours, and a key computed from stale neighbours could collide forever.
     *
     * Two moves into the same gap compute the same key; the unique (project_id, rank) index
     * rejects the second, which re-reads the neighbours (now including the first) and
     * retries, as `createIssue` does.
     */
    async moveIssue(input: MoveIssueData): Promise<{ rank: string }> {
      const afterIssueId = input.afterIssueId ?? null;
      for (let attempt = 1; ; attempt += 1) {
        // One read per attempt (it was four serial ones): the ranks around the target gap.
        const found = await neighbours(input.issueId, afterIssueId);
        if (!found) throw notFound("Issue");
        const { current, prev, next } = found;
        if (afterIssueId && prev === null) throw notFound("The issue to move after");
        // Already in place: nothing to write. (Keys compare bytewise, like COLLATE "C".)
        if ((prev === null || current > prev) && (next === null || current < next)) {
          return { rank: current };
        }
        const rank = generateKeyBetween(prev, next);
        await options.beforeRankWrite?.();
        try {
          // A reorder is not an edit: `updated_at` and `activity` are left alone, so the
          // list's "Updated" column and the issue history only show real changes.
          const result = await db.execute(sql`
            UPDATE issues SET rank = ${rank}
            WHERE id = ${input.issueId}::uuid AND deleted_at IS NULL
            RETURNING rank
          `);
          const [row] = rowsOf(result, z.object({ rank: z.string() }));
          if (!row) throw notFound("Issue");
          return { rank: row.rank };
        } catch (error) {
          const info = pgErrorInfo(error);
          const rankTaken =
            info?.code === UNIQUE_VIOLATION && info.constraint === "issues_project_rank_unique";
          if (!rankTaken) throw error;
          if (attempt >= RANK_ATTEMPTS) throw conflict("Too many concurrent moves; try again");
          // Jitter so racing movers do not collide again on the next attempt.
          await sleep(Math.random() * 20 * attempt);
        }
      }
    },

    /** MY-1: upserts the viewer's "recently viewed" row for a live issue. */
    async recordIssueView(userId: string, input: RecordViewData): Promise<void> {
      await db.execute(sql`
        INSERT INTO recent_views (user_id, entity_type, entity_id, viewed_at)
        SELECT ${userId}::uuid, 'issue', id, now() FROM issues
        WHERE id = ${input.issueId}::uuid AND deleted_at IS NULL
        ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE SET viewed_at = now()
      `);
    },
  };
}

export type PlanningService = ReturnType<typeof createPlanningService>;
