/**
 * SVC-1 "No secrets": a heuristic that refuses values that look like credentials anywhere in
 * the service form (names, notes, descriptions, environment notes, link labels and URLs).
 * Isomorphic: the form shows the same message the server action returns, but only the
 * server's check counts (the schema runs again in the action and in the service).
 *
 * It errs on the side of refusing: a false positive costs a reworded note ("shorten the
 * commit SHA"), a false negative leaks a credential into a table every HQ user can read.
 * It is not a guarantee, so the UI also says "Don't store passwords, tokens or connection
 * strings here". Matched values are never logged or echoed back.
 */

export type SecretKind =
  | "credentials_in_url"
  | "token_prefix"
  | "private_key"
  | "assignment"
  | "secret_query"
  | "webhook_url"
  | "high_entropy";

export interface SecretFinding {
  kind: SecretKind;
  /** A sentence for the person filling in the form; never contains the matched value. */
  message: string;
}

const MESSAGES: Record<SecretKind, string> = {
  credentials_in_url:
    "looks like a connection string with a username and password. Store where the service is, not how to log in",
  token_prefix: "looks like an access token or API key",
  private_key: "looks like a private key",
  assignment: "looks like a password, token or key",
  secret_query: "has a token, key or signature in its query string",
  webhook_url: "is a webhook URL, which works as a secret",
  high_entropy:
    "contains a long random-looking string, which could be a token or key (shorten a commit SHA to 12 characters)",
};

/** `scheme://user:password@host` (postgres, mysql, mongodb+srv, redis, amqp, https …). */
const CREDENTIALS_IN_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/?#@:]+:[^\s/?#@]*@/i;

/**
 * Well-known token formats: GitHub (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`),
 * OpenAI/Anthropic/Stripe-style `sk-…` / `sk_live_…`, AWS access key ids (`AKIA…`,
 * `ASIA…`), Slack (`xoxb-`, `xoxp-`, `xoxa-`, `xoxr-`, `xoxs-`), Google API keys (`AIza…`),
 * npm (`npm_…`) and GitLab (`glpat-…`). A word boundary in front, so "desk-…" is no match.
 */
const TOKEN_PREFIXES = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bnpm_[A-Za-z0-9]{30,}/,
  /\bglpat-[A-Za-z0-9_-]{20,}/,
];

const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

/** `password=…`, `api_key: …`, `secret = …`, `token: …` with a value of 6+ characters. */
const ASSIGNMENT =
  /\b(?:password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|access[_-]?key|auth[_-]?token|token)\s*[:=]\s*["']?[^\s"']{6,}/i;

/** Query parameters that carry credentials (presigned URLs, `?token=`, `?api_key=` …). */
const SECRET_QUERY_KEYS =
  /^(?:token|access_token|refresh_token|id_token|auth|authorization|key|api_key|apikey|secret|client_secret|password|pass|pwd|sig|signature|x-amz-signature|x-amz-credential|x-goog-signature)$/i;

/** Webhook URLs are bearer credentials: anyone holding one can post. */
const WEBHOOK_URLS = [
  /^https?:\/\/hooks\.slack\.com\/services\//i,
  /^https?:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\//i,
  /^https?:\/\/[^/]*\.webhook\.office\.com\//i,
];

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Shannon entropy in bits per character. */
export function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Shortest run that counts as "long" (task: base64/hex of 32+ characters). */
export const HIGH_ENTROPY_MIN_LENGTH = 32;

/**
 * A run of 32+ hex characters with letters and digits (an API key, a hash, a long SHA), or
 * of 32+ base64/base64url characters mixing upper case, lower case and digits with high
 * entropy. UUIDs (dashed) are fine: they identify things, they are not keys.
 */
function hasHighEntropyRun(text: string): boolean {
  const cleaned = text.replace(UUID, " ");
  for (const [run] of cleaned.matchAll(/[A-Za-z0-9+/_=-]{32,}/g)) {
    const body = run.replace(/=+$/, "");
    for (const [hex] of body.matchAll(/[0-9a-f]{32,}|[0-9A-F]{32,}/g)) {
      if (/[0-9]/.test(hex) && /[a-f]/i.test(hex)) return true;
    }
    if (
      body.length >= HIGH_ENTROPY_MIN_LENGTH &&
      /[A-Z]/.test(body) &&
      /[a-z]/.test(body) &&
      /[0-9]/.test(body) &&
      shannonEntropy(body) >= 4
    ) {
      return true;
    }
  }
  return false;
}

function finding(kind: SecretKind): SecretFinding {
  return { kind, message: MESSAGES[kind] };
}

/** Checks shared by text and URLs. */
function commonChecks(value: string): SecretFinding | null {
  if (CREDENTIALS_IN_URL.test(value)) return finding("credentials_in_url");
  if (PRIVATE_KEY.test(value)) return finding("private_key");
  if (TOKEN_PREFIXES.some((pattern) => pattern.test(value))) return finding("token_prefix");
  return null;
}

/** Free text (names, notes, descriptions, labels). Null when nothing looks secret. */
export function findSecretInText(value: string): SecretFinding | null {
  const common = commonChecks(value);
  if (common) return common;
  if (ASSIGNMENT.test(value)) return finding("assignment");
  if (hasHighEntropyRun(value)) return finding("high_entropy");
  return null;
}

/**
 * A stored link. The path is not checked for entropy (commit and dashboard URLs carry long
 * ids there); the query string and fragment are, together with known secret parameters and
 * webhook hosts. `user:password@` is refused here too (and by `parseSafeUrl`).
 */
export function findSecretInUrl(value: string): SecretFinding | null {
  const common = commonChecks(value);
  if (common) return common;
  if (WEBHOOK_URLS.some((pattern) => pattern.test(value))) return finding("webhook_url");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Not a URL at all: `safeUrlSchema` reports that; check it like text meanwhile.
    return findSecretInText(value);
  }
  if (url.username || url.password) return finding("credentials_in_url");
  for (const [key, paramValue] of url.searchParams) {
    if (SECRET_QUERY_KEYS.test(key) && paramValue !== "") return finding("secret_query");
    if (hasHighEntropyRun(paramValue)) return finding("high_entropy");
  }
  const fragment = url.hash.slice(1);
  if (fragment && (ASSIGNMENT.test(decodeSafe(fragment)) || hasHighEntropyRun(fragment))) {
    return finding("high_entropy");
  }
  return null;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The error shown for a field, e.g. "Notes looks like a password, token or key. …". */
export function secretErrorMessage(fieldLabel: string, found: SecretFinding): string {
  return `${fieldLabel} ${found.message}. Don't store passwords, tokens or connection strings here.`;
}
