import { sql } from "drizzle-orm";
import { z } from "zod";

import { type AppDatabase, type RunAtomic } from "@/server/db/types";
import { rowsOf } from "@/server/services/sql";

import { constantTimeEqual, hashToken, isUnsubscribeToken } from "./tokens";

/**
 * NTF-2 one-click unsubscribe (POST /unsubscribe?token=…). Public: the token is the
 * credential. Order:
 *
 *   1. rate limit per client IP: one `login_attempts` row per attempt under the key
 *      `unsubscribe-ip:<bucket>` (AUTH-8's table and reservation pattern), inserted only
 *      while fewer than `MAX_FAILURES_PER_IP` failures are in the window, under an advisory
 *      lock so parallel requests cannot all pass the count;
 *   2. look the user up by the token's sha-256 (the stored form), then compare the hashes
 *      in constant time;
 *   3. `notify_email = false` (idempotent), and the attempt stops counting as a failure.
 *
 * The caller answers the same way whether or not the token matched anyone, so the route
 * reveals nothing about accounts.
 */

export const UNSUBSCRIBE_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_IP = 20;
/** Its own advisory-lock namespace (AUTH-8 uses 8001/8002). */
const UNSUBSCRIBE_LOCK_NAMESPACE = 8_003;

export type UnsubscribeOutcome = "done" | "rate_limited";

const reservedRow = z.object({ id: z.string() });
const userRow = z.object({ id: z.string(), hash: z.string() });

export function unsubscribeKey(ipBucket: string): string {
  return `unsubscribe-ip:${ipBucket}`;
}

export function createUnsubscribeService(
  db: AppDatabase,
  { runAtomic, now = () => new Date() }: { runAtomic: RunAtomic; now?: () => Date },
) {
  return {
    /**
     * Unsubscribes the token's owner. "done" whether or not the token was valid (the page
     * says the same either way); "rate_limited" when this IP used up its budget.
     */
    async unsubscribe(token: string, ipBucket: string): Promise<UnsubscribeOutcome> {
      const key = unsubscribeKey(ipBucket);
      const at = now();
      const since = new Date(at.getTime() - UNSUBSCRIBE_WINDOW_MS).toISOString();
      // Only failures count (a valid link flips its row to success), so mail providers that
      // send one-click POSTs from shared IPs only share the budget for stale links.
      const [, reserved] = await runAtomic([
        sql`SELECT pg_advisory_xact_lock(${UNSUBSCRIBE_LOCK_NAMESPACE}::int, hashtext(${key}::text))`,
        sql`
          INSERT INTO login_attempts (key, success, attempted_at)
          SELECT ${key}::text, false, ${at.toISOString()}::timestamptz
          WHERE (SELECT count(*) FROM login_attempts
            WHERE key = ${key}::text AND NOT success AND attempted_at > ${since}::timestamptz
          ) < ${MAX_FAILURES_PER_IP}::int
          RETURNING id::text
        `,
        // Keep the table small: this key's rows outside any window.
        sql`DELETE FROM login_attempts WHERE key = ${key}::text
          AND attempted_at < ${new Date(at.getTime() - 24 * 60 * 60 * 1000).toISOString()}::timestamptz`,
      ]);
      const [attempt] = rowsOf(reserved, reservedRow);
      if (!attempt) return "rate_limited";
      if (!isUnsubscribeToken(token)) return "done";

      const hash = hashToken(token);
      const found = rowsOf(
        await db.execute(sql`
          SELECT id::text, email_unsubscribe_token_hash AS hash FROM users
          WHERE email_unsubscribe_token_hash = ${hash}::text
        `),
        userRow,
      )[0];
      // The indexed lookup compares sha-256 digests, whose timing says nothing usable about
      // the token; the constant-time compare is defence in depth on top of it.
      if (!found || !constantTimeEqual(found.hash, hash)) return "done";

      await runAtomic([
        sql`UPDATE users SET notify_email = false, updated_at = now()
          WHERE id = ${found.id}::uuid AND email_unsubscribe_token_hash = ${hash}::text`,
        // A valid link is not a failed attempt.
        sql`UPDATE login_attempts SET success = true WHERE id = ${attempt.id}::uuid`,
      ]);
      return "done";
    },
  };
}

export type UnsubscribeService = ReturnType<typeof createUnsubscribeService>;
