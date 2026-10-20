import { formatIssueKey, type IssueRef } from "@/lib/issues/keys";

/**
 * GH-2 / GH-3 text matching. Isomorphic and pure.
 *
 * Keys are matched case-insensitively, because GH-5 branch names are lower case
 * (`stk-42-oom-ocr`). Any 2–5 letter prefix is returned (upper-cased); the database keeps
 * only keys of projects and issues that exist, so `UTF-8` or `sha-256` are dropped there
 * and unknown keys are ignored silently.
 */

/** Postgres `integer` upper bound; larger numbers cannot be issue numbers. */
const MAX_ISSUE_NUMBER = 2_147_483_647;

/** Bounds the work one webhook delivery can cause, whatever the PR body holds. */
export const MAX_KEYS_PER_TEXT = 50;

/**
 * `\b` on both sides: `XSTK-1` (prefix too long or glued to a letter) and `STK-1a` are not
 * `STK-1`. `-` and `/` are boundaries, so `feature/stk-42-oom` matches.
 */
const KEY = String.raw`\b([A-Za-z]{2,5})-(\d{1,10})\b`;
/** The same, without capture groups, for use inside larger patterns. */
const KEY_PLAIN = String.raw`\b[A-Za-z]{2,5}-\d{1,10}\b`;

function toRef(prefix: string | undefined, digits: string | undefined): IssueRef | null {
  if (!prefix || !digits) return null;
  const number = Number(digits);
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_ISSUE_NUMBER) return null;
  return { projectKey: prefix.toUpperCase(), number };
}

function pushUnique(refs: IssueRef[], seen: Set<string>, ref: IssueRef | null): void {
  if (!ref || refs.length >= MAX_KEYS_PER_TEXT) return;
  const key = formatIssueKey(ref.projectKey, ref.number);
  if (seen.has(key)) return;
  seen.add(key);
  refs.push(ref);
}

/** Unique issue keys in order of first appearance, e.g. from a branch name or a PR title. */
export function extractIssueKeys(...texts: readonly (string | null | undefined)[]): IssueRef[] {
  const refs: IssueRef[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(new RegExp(KEY, "g"))) {
      pushUnique(refs, seen, toRef(match[1], match[2]));
    }
  }
  return refs;
}

/**
 * Closing keywords (GH-3): `close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`,
 * `resolves`, `resolved`, any case, optionally followed by a colon, then one or more keys
 * separated by commas, `and` or `&` ("Fixes STK-1, STK-2"). The keyword must be a whole
 * word: "prefix STK-1" and "not fixing STK-1" close nothing.
 */
const CLOSING = new RegExp(
  String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b(?::\s*|\s+)(${KEY_PLAIN}(?:\s*(?:,|&|\band\b)\s*${KEY_PLAIN})*)`,
  "gi",
);

/** Keys a merged PR's title or body says it closes, unique, in order of first appearance. */
export function parseClosingKeys(...texts: readonly (string | null | undefined)[]): IssueRef[] {
  const refs: IssueRef[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(CLOSING)) {
      for (const ref of extractIssueKeys(match[1])) pushUnique(refs, seen, ref);
    }
  }
  return refs;
}

/**
 * GitHub's username rules: 1–39 characters, ASCII letters, digits and single hyphens, not
 * starting or ending with a hyphen.
 */
export const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
