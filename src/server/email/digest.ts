import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { users } from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";
import { type NotificationQueries } from "@/server/services/notification-queries";
import { rowsOf } from "@/server/services/sql";

import { buildDigestEmail, DIGEST_MAX_ITEMS } from "./digest-content";
import { isDigestDue, periodStartFor } from "./due";
import { type SendEmail } from "./resend";
import { newUnsubscribeToken } from "./tokens";

/**
 * NTF-2 digest job, run by `/api/cron/digest`. For each opted-in user whose digest is due:
 *
 *   1. claim the period: INSERT a `pending` `email_deliveries` row, unique on
 *      (user, kind, period_start), `ON CONFLICT` doing nothing, so concurrent or repeated
 *      runs (Vercel may invoke a cron twice) send at most once. A `failed` row, or a
 *      `pending` one older than `STALE_CLAIM` (a crashed run), is claimed again;
 *   2. read the unread notifications of the period (≤ 50, plus the total);
 *   3. none → `skipped`; otherwise send through Resend with a new unsubscribe token
 *      (Idempotency-Key = the claim: delivery id + claim time, so the 5xx retry inside one
 *      claim can never send twice), then `sent` with the provider id (storing the new
 *      token's hash, which revokes older links) or `failed` with a short code.
 *      `last_digest_at` moves to the period's end only on sent/skipped, so a failed period
 *      is retried by the next run (weekly ones too, without waiting for Monday). If
 *      recording a send fails twice, the claim stays `pending`; reclaiming it after
 *      `STALE_CLAIM` can then send that period twice (the only duplicate path, accepted).
 *
 * Logs carry ids, counts and error codes only: never addresses or content.
 */

export const STALE_CLAIM = "15 minutes";
/** Each send can take ~20 s at worst (10 s timeout, one retry). */
export const DEFAULT_BUDGET_MS = 35_000;

export interface DigestConfig {
  from: string;
  /** APP_BASE_URL (origin, no trailing slash). */
  baseUrl: string;
}

export interface DigestRunResult {
  due: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Claimed by another run (or already done for this period). */
  busy: number;
  /** Due, but left for the next run because this one ran out of time. */
  deferred: number;
}

const claimRow = z.object({ id: z.string(), claimed: z.string() });

export function createDigestJob(deps: {
  db: AppDatabase;
  notificationQueries: Pick<NotificationQueries, "unreadInPeriod">;
  send: SendEmail;
  config: DigestConfig;
  now?: () => Date;
  /** Stop starting sends after this long (the cron route's `maxDuration` is 60 s). */
  budgetMs?: number;
  log?: (line: Record<string, unknown>) => void;
}) {
  const { db, config } = deps;
  const now = deps.now ?? (() => new Date());
  const budgetMs = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const log = deps.log ?? ((line) => process.stdout.write(`[digest] ${JSON.stringify(line)}\n`));

  /**
   * Step 1. Returns the delivery id and this claim's idempotency key, or null when another
   * run holds the period. The key changes with every (re)claim: Resend refuses a reused key
   * with a different body for 24 h, and a retried period has a new unsubscribe token.
   */
  async function claim(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<{ id: string; key: string } | null> {
    const result = await db.execute(sql`
      INSERT INTO email_deliveries (user_id, kind, period_start, period_end, status)
      VALUES (${userId}::uuid, 'digest', ${start.toISOString()}::timestamptz,
        ${end.toISOString()}::timestamptz, 'pending')
      ON CONFLICT (user_id, kind, period_start) DO UPDATE
        SET status = 'pending', period_end = EXCLUDED.period_end, error_code = NULL,
          provider_id = NULL, sent_at = NULL, updated_at = clock_timestamp()
        WHERE email_deliveries.status = 'failed'
          OR (email_deliveries.status = 'pending'
            AND email_deliveries.updated_at < now() - ${STALE_CLAIM}::interval)
      RETURNING id::text, floor(extract(epoch FROM updated_at) * 1000)::bigint::text AS claimed
    `);
    const [row] = rowsOf(result, claimRow);
    return row ? { id: row.id, key: `digest-${row.id}-${row.claimed}` } : null;
  }

  /**
   * `sent` (storing the emailed link's token hash) or `skipped`, and the next period
   * starts at this one's end: one statement.
   */
  async function finish(
    deliveryId: string,
    outcome: { status: "skipped" } | { status: "sent"; providerId: string; tokenHash: string },
  ) {
    const providerId = outcome.status === "sent" ? outcome.providerId : null;
    const tokenHash = outcome.status === "sent" ? outcome.tokenHash : null;
    await db.execute(sql`
      WITH done AS (
        UPDATE email_deliveries
        SET status = ${outcome.status}::email_delivery_status,
          sent_at = CASE WHEN ${outcome.status}::text = 'sent' THEN now() END,
          provider_id = ${providerId}::text, updated_at = now()
        WHERE id = ${deliveryId}::uuid AND status = 'pending'
        RETURNING user_id, period_end
      )
      UPDATE users u SET
        last_digest_at = GREATEST(u.last_digest_at, d.period_end),
        -- Rotated only once the email with the new link is out, so a failed send never
        -- breaks the link in the last email that did arrive.
        email_unsubscribe_token_hash = COALESCE(${tokenHash}::text, u.email_unsubscribe_token_hash),
        updated_at = now()
      FROM done d
      WHERE u.id = d.user_id
    `);
  }

  async function fail(deliveryId: string, errorCode: string) {
    await db.execute(sql`
      UPDATE email_deliveries
      SET status = 'failed', error_code = ${errorCode}::text, updated_at = now()
      WHERE id = ${deliveryId}::uuid AND status = 'pending'
    `);
  }

  async function digestFor(
    user: { id: string; email: string; frequency: "daily" | "weekly"; lastDigestAt: Date | null },
    at: Date,
  ): Promise<keyof Omit<DigestRunResult, "due" | "deferred">> {
    const start = periodStartFor(user, at);
    if (at.getTime() <= start.getTime()) return "busy";
    const claimed = await claim(user.id, start, at);
    if (!claimed) return "busy";
    const deliveryId = claimed.id;
    let accepted = false;
    try {
      const { items, total } = await deps.notificationQueries.unreadInPeriod(
        user.id,
        { after: start, upTo: at },
        DIGEST_MAX_ITEMS,
      );
      if (total === 0) {
        await finish(deliveryId, { status: "skipped" });
        return "skipped";
      }
      // A new token per digest; its hash replaces the old one once this email is sent, so
      // the previous emails' unsubscribe links stop working then.
      const { token, hash } = newUnsubscribeToken();
      const unsubscribeUrl = `${config.baseUrl}/unsubscribe?token=${token}`;
      const content = buildDigestEmail({ items, total, baseUrl: config.baseUrl, unsubscribeUrl });
      const result = await deps.send({
        from: config.from,
        to: user.email,
        ...content,
        // RFC 8058 one-click unsubscribe (mail clients POST to the https link).
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        idempotencyKey: claimed.key,
      });
      if (result.ok) {
        accepted = true;
        const sent = { status: "sent", providerId: result.providerId, tokenHash: hash } as const;
        // Resend has the email: never mark it failed now (that would send it again). One
        // retry; if that fails too the claim stays `pending` and is reclaimed when stale.
        await finish(deliveryId, sent).catch(() => finish(deliveryId, sent));
        log({ delivery: deliveryId, status: "sent", items: items.length, total });
        return "sent";
      }
      await fail(deliveryId, result.errorCode);
      log({ delivery: deliveryId, status: "failed", code: result.errorCode });
      return "failed";
    } catch (error) {
      log({
        delivery: deliveryId,
        status: accepted ? "sent_unrecorded" : "failed",
        code: "internal_error",
        error: error instanceof Error ? error.name : "unknown",
      });
      if (accepted) return "sent";
      // The claim stays `pending` if even this fails; it is reclaimed once stale.
      await fail(deliveryId, "internal_error").catch(() => undefined);
      return "failed";
    }
  }

  return {
    async run(): Promise<DigestRunResult> {
      const at = now();
      const startedAt = Date.now();
      const candidates = await db
        .select({
          id: users.id,
          email: users.email,
          frequency: users.digestFrequency,
          lastDigestAt: users.lastDigestAt,
          // A failed (or crashed) send of the current period: retried now, any weekday.
          // (Correlated on the outer `users` row; written out so no column is ambiguous.)
          retry: sql<boolean>`EXISTS (SELECT 1 FROM email_deliveries e
            WHERE e.user_id = "users"."id" AND e.kind = 'digest'
              AND e.period_start = "users"."last_digest_at"
              AND (e.status = 'failed' OR (e.status = 'pending'
                AND e.updated_at < now() - ${STALE_CLAIM}::interval)))`,
        })
        .from(users)
        .where(eq(users.notifyEmail, true));
      const due = candidates.filter((user) => user.retry || isDigestDue(user, at));
      const result: DigestRunResult = {
        due: due.length,
        sent: 0,
        skipped: 0,
        failed: 0,
        busy: 0,
        deferred: 0,
      };
      // One user at a time: a handful of users, and Resend allows ~10 requests per second.
      // Stop starting new sends before the function's time limit; the rest stay due (daily
      // users: next run; weekly users: next Monday, as they have no failed claim to retry).
      for (const user of due) {
        if (Date.now() - startedAt > budgetMs) result.deferred += 1;
        else result[await digestFor(user, at)] += 1;
      }
      log({ run: "done", ...result });
      return result;
    },
  };
}

export type DigestJob = ReturnType<typeof createDigestJob>;
