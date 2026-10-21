import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { type UserOption } from "@/lib/issues/views";
import { directRead, type Read } from "@/server/db/read-batch";
import { users, watchers } from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

import { notFound } from "./errors";
import { type IdRef, rowsOf } from "./sql";

/**
 * ISS-11 watchers. Reporter, assignee and commenters are added automatically by the writes
 * that make them so (issues.ts, comments.ts); here anyone signed in watches or unwatches an
 * issue for THEMSELVES (the user is always the session user, never an input).
 *
 * Watching is a personal subscription, not a field of the issue, so it writes no activity.
 */
export function createWatcherService(db: AppDatabase, { read = directRead }: { read?: Read } = {}) {
  return {
    /** Watches (true) or unwatches (false) a live issue. Idempotent. */
    async setWatching(
      userId: string,
      input: { issueId: string; watching: boolean },
    ): Promise<{ watching: boolean }> {
      const write = input.watching
        ? sql`
            WITH issue AS (
              SELECT id FROM issues WHERE id = ${input.issueId}::uuid AND deleted_at IS NULL
            ),
            added AS (
              INSERT INTO watchers (issue_id, user_id)
              SELECT id, ${userId}::uuid FROM issue
              ON CONFLICT DO NOTHING
            )
            SELECT count(*)::int AS found FROM issue`
        : sql`
            WITH issue AS (
              SELECT id FROM issues WHERE id = ${input.issueId}::uuid AND deleted_at IS NULL
            ),
            removed AS (
              DELETE FROM watchers
              WHERE issue_id = ${input.issueId}::uuid AND user_id = ${userId}::uuid
            )
            SELECT count(*)::int AS found FROM issue`;
      const [row] = rowsOf(await db.execute(write), z.object({ found: z.number() }));
      if (!row || row.found === 0) throw notFound("Issue");
      return { watching: input.watching };
    },

    /** The issue's watchers, in the order they started watching. */
    async list(issueId: IdRef): Promise<UserOption[]> {
      return read(
        db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(watchers)
          .innerJoin(users, eq(users.id, watchers.userId))
          .where(eq(watchers.issueId, issueId))
          .orderBy(asc(watchers.createdAt), asc(users.name)),
      );
    },
  };
}

export type WatcherService = ReturnType<typeof createWatcherService>;
