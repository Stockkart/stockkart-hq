import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * S-4 / GH-1: GitHub signs each delivery with HMAC-SHA256 of the RAW request body, keyed with
 * the webhook secret, in `X-Hub-Signature-256: sha256=<64 hex>`.
 *
 * The comparison is constant-time (`timingSafeEqual`) so the response time reveals nothing
 * about how much of a forged signature was right. `timingSafeEqual` throws on a length
 * mismatch, so lengths are checked first (the length of a SHA-256 digest is public).
 */
export function verifyGithubSignature(
  secret: string,
  body: Uint8Array,
  header: string | null,
): boolean {
  if (!secret || !header) return false;
  const match = /^sha256=([0-9a-fA-F]+)$/.exec(header.trim());
  if (!match?.[1] || match[1].length % 2 !== 0) return false;
  const given = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

/** `sha256=<hex>` for a body; used by tests and `scripts/send-test-webhook.ts`. */
export function signGithubPayload(secret: string, body: Uint8Array | string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}
