import { and, count, eq, gt, inArray, lt } from "drizzle-orm";

import type { Database } from "@/server/db/client";
import { loginAttempts } from "@/server/db/schema";

/**
 * AUTH-8: at most 5 failed sign-ins per email and 20 per IP in a sliding 15-minute window.
 * Attempts live in Postgres (`login_attempts`) because serverless instances share no memory.
 */

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_EMAIL = 5;
export const MAX_FAILURES_PER_IP = 20;
/** Rows older than this are pruned opportunistically. */
const RETENTION_MS = 24 * 60 * 60 * 1000;

export interface LoginAttemptStore {
  countFailuresSince(key: string, since: Date): Promise<number>;
  record(keys: readonly string[], success: boolean, at: Date): Promise<void>;
}

export interface RateLimiter {
  /** True when this email or IP has used up its failed-attempt budget. */
  isLimited(email: string, ip: string): Promise<boolean>;
  recordFailure(email: string, ip: string): Promise<void>;
  recordSuccess(email: string, ip: string): Promise<void>;
}

export function emailKey(email: string): string {
  return `email:${email.trim().toLowerCase()}`;
}

export function ipKey(ip: string): string {
  return `ip:${ip}`;
}

export function createRateLimiter(
  store: LoginAttemptStore,
  now: () => Date = () => new Date(),
): RateLimiter {
  return {
    async isLimited(email, ip) {
      const since = new Date(now().getTime() - RATE_LIMIT_WINDOW_MS);
      const [emailFailures, ipFailures] = await Promise.all([
        store.countFailuresSince(emailKey(email), since),
        store.countFailuresSince(ipKey(ip), since),
      ]);
      return emailFailures >= MAX_FAILURES_PER_EMAIL || ipFailures >= MAX_FAILURES_PER_IP;
    },
    async recordFailure(email, ip) {
      await store.record([emailKey(email), ipKey(ip)], false, now());
    },
    async recordSuccess(email, ip) {
      await store.record([emailKey(email), ipKey(ip)], true, now());
    },
  };
}

export function createPostgresAttemptStore(db: Database): LoginAttemptStore {
  return {
    async countFailuresSince(key, since) {
      const [row] = await db
        .select({ value: count() })
        .from(loginAttempts)
        .where(
          and(
            eq(loginAttempts.key, key),
            eq(loginAttempts.success, false),
            gt(loginAttempts.attemptedAt, since),
          ),
        );
      return row?.value ?? 0;
    },
    async record(keys, success, at) {
      await db.insert(loginAttempts).values(keys.map((key) => ({ key, success, attemptedAt: at })));
      // Keep the table small: drop this key's rows that can no longer affect any window.
      await db
        .delete(loginAttempts)
        .where(
          and(
            inArray(loginAttempts.key, [...keys]),
            lt(loginAttempts.attemptedAt, new Date(at.getTime() - RETENTION_MS)),
          ),
        );
    },
  };
}

/**
 * Client IP for rate limiting. On Vercel, `x-real-ip` and `x-forwarded-for` are set by the
 * platform edge (client-supplied values are overwritten), so they can be trusted there.
 * If neither is present, every such request shares one "unknown" bucket, which errs on the
 * side of limiting rather than letting a missing header bypass the IP limit.
 */
export function clientIpFrom(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return "unknown";
}
