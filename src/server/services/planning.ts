import { and, asc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

import { type moveIssueInput, type recordViewInput } from "@/lib/planning/schemas";
import { issues } from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

import { conflict, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";
import { rowsOf } from "./sql";

export type MoveIssueData = z.output<typeof moveIssueInput>;
export type RecordViewData = z.output<typeof recordViewInput>;

/** Attempts when concurrent moves keep landing on the same gap (see `moveIssue`). */
const RANK_ATTEMPTS = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface PlanningServiceOptions {
  /** Test hook: runs between reading the neighbours and writing the new rank. */
  beforeRankWrite?: () => Promise<void>;
}

/** Backlog ordering (BLG-1) and My Work view tracking (MY-1). */
export function createPlanningService(db: AppDatabase, options: PlanningServiceOptions = {}) {
  async function rankOf(issueId: string, projectId?: string): Promise<string | null> {
    const [row] = await db
      .select({ rank: issues.rank })
      .from(issues)
      .where(
        and(
          eq(issues.id, issueId),
          isNull(issues.deletedAt),
          projectId ? eq(issues.projectId, projectId) : undefined,
        ),
      )
      .limit(1);
    return row?.rank ?? null;
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
      const [issue] = await db
        .select({ id: issues.id, projectId: issues.projectId })
        .from(issues)
        .where(and(eq(issues.id, input.issueId), isNull(issues.deletedAt)))
        .limit(1);
      if (!issue) throw notFound("Issue");

      for (let attempt = 1; ; attempt += 1) {
        const current = await rankOf(issue.id);
        if (current === null) throw notFound("Issue");
        let prev: string | null = null;
        if (input.afterIssueId) {
          prev = await rankOf(input.afterIssueId, issue.projectId);
          if (prev === null) throw notFound("The issue to move after");
        }
        const [successor] = await db
          .select({ rank: issues.rank })
          .from(issues)
          .where(
            and(
              eq(issues.projectId, issue.projectId),
              ne(issues.id, issue.id),
              prev === null ? undefined : gt(issues.rank, prev),
            ),
          )
          .orderBy(asc(issues.rank))
          .limit(1);
        const next = successor?.rank ?? null;
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
            WHERE id = ${issue.id}::uuid AND deleted_at IS NULL
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
