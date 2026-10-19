import { inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/server/db/client";
import { loginAttempts } from "@/server/db/schema";

/**
 * AUTH-8: at most 5 failed sign-ins per email and 20 per IP in a sliding 15-minute window.
 * Attempts live in Postgres (`login_attempts`) because serverless instances share no memory.
 *
 * The limit is enforced with a reservation, not with check-then-record: before inventory-api
 * is asked, one `success=false` row per key is inserted *atomically with the count*, and the
 * insert only happens when every key is still under its limit. Parallel requests therefore
 * cannot all pass the check before any failure is written. A sign-in that succeeds flips its
 * rows to `success=true`; one that never got an answer (inventory-api down) deletes them.
 * Anything else, including a crash half-way, leaves the rows counting as failures.
 */

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_EMAIL = 5;
export const MAX_FAILURES_PER_IP = 20;
/** Rows older than this are pruned opportunistically. */
const RETENTION_MS = 24 * 60 * 60 * 1000;

export interface AttemptLimit {
  key: string;
  /** The attempt is refused when this many failures already exist in the window. */
  max: number;
}

export interface LoginAttemptStore {
  /**
   * Atomically: count the failures in the window for both keys and, only if both are below
   * their `max`, insert one `success=false` row per key. Returns the new row ids, or `null`
   * when a limit is reached (nothing is inserted). Throws when the store is unreachable.
   */
  reserve(email: AttemptLimit, ip: AttemptLimit, since: Date, at: Date): Promise<string[] | null>;
  /** Flips reserved rows to `success=true` so they stop counting as failures. */
  markSuccess(ids: readonly string[]): Promise<void>;
  /** Deletes reserved rows for an attempt that never got a verdict. */
  release(ids: readonly string[]): Promise<void>;
}

/** A reserved attempt. It counts as a failure unless one of these is called. */
export interface LoginAttemptReservation {
  succeeded(): Promise<void>;
  release(): Promise<void>;
}

export interface RateLimiter {
  /**
   * Reserves one attempt for this email and IP, or returns `null` when either has used up
   * its failed-attempt budget. Throws when the store is unreachable (callers fail closed).
   */
  reserve(email: string, ip: string): Promise<LoginAttemptReservation | null>;
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
    async reserve(email, ip) {
      const at = now();
      const since = new Date(at.getTime() - RATE_LIMIT_WINDOW_MS);
      const ids = await store.reserve(
        { key: emailKey(email), max: MAX_FAILURES_PER_EMAIL },
        { key: ipKey(ip), max: MAX_FAILURES_PER_IP },
        since,
        at,
      );
      if (!ids) return null;
      return {
        succeeded: () => store.markSuccess(ids),
        release: () => store.release(ids),
      };
    },
  };
}

/**
 * Advisory-lock namespaces (the first argument of the two-key `pg_advisory_xact_lock`).
 * Email and IP locks live in separate namespaces and are always taken email first, then
 * IP, so two attempts can never wait on each other in a cycle (no deadlocks), and a hash
 * collision between an email key and an IP key cannot make them share a lock.
 */
const EMAIL_LOCK_NAMESPACE = 8_001;
const IP_LOCK_NAMESPACE = 8_002;

const insertedRows = z.object({ rows: z.array(z.object({ id: z.string() })) });

/**
 * Uses Neon's HTTP driver. It has no interactive transactions, but `db.batch()` sends all
 * statements as one non-interactive transaction (`sql.transaction([...])`, READ COMMITTED),
 * which is all the reservation needs:
 *   1. take the email lock, 2. take the IP lock (both held until the transaction ends),
 *   3. count + conditional insert in one statement, 4. prune old rows for these keys.
 * Under READ COMMITTED every statement takes a fresh snapshot, so statement 3 runs after
 * the locks are held and sees every row committed by the previous holder.
 */
export function createPostgresAttemptStore(db: Database): LoginAttemptStore {
  return {
    async reserve(email, ip, since, at) {
      const sinceIso = since.toISOString();
      const pruneBefore = new Date(at.getTime() - RETENTION_MS).toISOString();
      const [, , inserted] = await db.batch([
        db.execute(
          sql`SELECT pg_advisory_xact_lock(${EMAIL_LOCK_NAMESPACE}::int, hashtext(${email.key}::text))`,
        ),
        db.execute(
          sql`SELECT pg_advisory_xact_lock(${IP_LOCK_NAMESPACE}::int, hashtext(${ip.key}::text))`,
        ),
        // Inserts both rows or neither: the WHERE clause is the limit check.
        db.execute(sql`
          INSERT INTO login_attempts (key, success, attempted_at)
          SELECT k, false, ${at.toISOString()}::timestamptz
          FROM unnest(ARRAY[${email.key}::text, ${ip.key}::text]) AS t(k)
          WHERE (
              SELECT count(*) FROM login_attempts
              WHERE key = ${email.key}::text AND NOT success
                AND attempted_at > ${sinceIso}::timestamptz
            ) < ${email.max}::int
            AND (
              SELECT count(*) FROM login_attempts
              WHERE key = ${ip.key}::text AND NOT success
                AND attempted_at > ${sinceIso}::timestamptz
            ) < ${ip.max}::int
          RETURNING id
        `),
        // Keep the table small: drop this key's rows that can no longer affect any window.
        db.execute(sql`
          DELETE FROM login_attempts
          WHERE key IN (${email.key}::text, ${ip.key}::text)
            AND attempted_at < ${pruneBefore}::timestamptz
        `),
      ]);
      const ids = insertedRows.parse(inserted).rows.map((row) => row.id);
      return ids.length > 0 ? ids : null;
    },
    async markSuccess(ids) {
      if (ids.length === 0) return;
      await db
        .update(loginAttempts)
        .set({ success: true })
        .where(inArray(loginAttempts.id, [...ids]));
    },
    async release(ids) {
      if (ids.length === 0) return;
      await db.delete(loginAttempts).where(inArray(loginAttempts.id, [...ids]));
    },
  };
}

/**
 * Client IP for rate limiting.
 *
 * TRUST: `x-real-ip` and `x-forwarded-for` are trusted ONLY because Vercel's edge overwrites
 * them with the real client address (client-supplied values never reach us). On any other
 * host (self-hosted `next start`, another proxy or CDN) a caller can set these headers
 * freely and get a fresh IP budget per request; make the proxy in front overwrite them or
 * change this function before deploying there (see README "Deploying to Vercel").
 *
 * IPv6 clients usually control a whole /64, so IPv6 addresses are bucketed by their /64
 * prefix; otherwise one client could rotate through 2^64 addresses for fresh budgets.
 * IPv4-mapped IPv6 addresses (`::ffff:192.0.2.1`) count as the IPv4 address.
 *
 * If neither header is present, every such request shares one "unknown" bucket, which errs
 * on the side of limiting rather than letting a missing header bypass the IP limit.
 */
export function clientIpFrom(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return rateLimitBucket(realIp);
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return rateLimitBucket(forwarded);
  return "unknown";
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(value: string): number[] | null {
  const match = IPV4.exec(value);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/** Expands an IPv6 address to its 8 hextets, or returns null if it is not valid IPv6. */
function parseIpv6(value: string): number[] | null {
  let address = value.toLowerCase();
  // A trailing dotted quad (`::ffff:1.2.3.4`, `64:ff9b::1.2.3.4`) is two hextets.
  const lastColon = address.lastIndexOf(":");
  const tail = parseIpv4(address.slice(lastColon + 1));
  if (tail) {
    const [a = 0, b = 0, c = 0, d = 0] = tail;
    address = `${address.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string | undefined) => (part ? part.split(":") : []);
  const head = parse(halves[0]);
  const rest = parse(halves[1]);
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

/** Normalises a client address into the bucket it is rate limited under. */
function rateLimitBucket(raw: string): string {
  // Strip `[...]` brackets and an IPv6 zone id (`fe80::1%eth0`).
  const value = raw.replace(/^\[(.*)\]$/, "$1").replace(/%.*$/, "");
  if (!value.includes(":")) return value;

  const hextets = parseIpv6(value);
  // Not an address we understand: rate limit on the raw string (bounded in length).
  if (!hextets) return raw.slice(0, 64);

  const isV4Mapped = hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff;
  if (isV4Mapped) {
    const [, , , , , , high = 0, low = 0] = hextets;
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }
  return `${hextets
    .slice(0, 4)
    .map((h) => h.toString(16))
    .join(":")}::/64`;
}
