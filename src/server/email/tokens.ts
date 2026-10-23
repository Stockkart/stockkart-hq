import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * NTF-2 secrets compared in constant time: the one-click unsubscribe token and the cron
 * job's bearer secret.
 *
 * Unsubscribe tokens are 32 random bytes (base64url, 43 characters). Only their sha-256
 * (lowercase hex) is stored, in `users.email_unsubscribe_token_hash`, so reading the
 * database never lets anyone unsubscribe someone; each digest stores a new hash, which
 * revokes the links of older emails.
 */

export const UNSUBSCRIBE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newUnsubscribeToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isUnsubscribeToken(value: unknown): value is string {
  return typeof value === "string" && UNSUBSCRIBE_TOKEN_PATTERN.test(value);
}

/**
 * Constant-time equality of two strings. Both sides are hashed first, so the comparison
 * takes the same time whatever the inputs' lengths (`timingSafeEqual` needs equal lengths,
 * and comparing lengths first would leak the secret's length).
 */
export function constantTimeEqual(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b) && given.length === expected.length;
}

/**
 * Vercel Cron's `Authorization: Bearer <CRON_SECRET>` check. False without a configured
 * secret (the route answers 503 before calling this) or without a well-formed header.
 */
export function verifyCronAuthorization(
  secret: string | undefined,
  header: string | null,
): boolean {
  if (!secret || !header) return false;
  const match = /^Bearer (\S+)$/.exec(header);
  if (!match?.[1]) return false;
  return constantTimeEqual(match[1], secret);
}
