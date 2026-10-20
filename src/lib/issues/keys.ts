/**
 * Issue keys (`STK-123`), references in text and branch names. Isomorphic.
 */

/** PRJ-1: 2–5 uppercase letters. */
export const PROJECT_KEY_PATTERN = /^[A-Z]{2,5}$/;
/** Postgres `integer` upper bound; larger numbers cannot be issue numbers. */
const MAX_ISSUE_NUMBER = 2_147_483_647;

export interface IssueRef {
  projectKey: string;
  number: number;
}

export function formatIssueKey(projectKey: string, number: number): string {
  return `${projectKey}-${number}`;
}

/** Parses `STK-12` (case-insensitive); returns the canonical upper-case parts or null. */
export function parseIssueKey(value: string): IssueRef | null {
  const match = /^([A-Za-z]{2,5})-(\d{1,10})$/.exec(value.trim());
  if (!match?.[1] || !match[2]) return null;
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_ISSUE_NUMBER) return null;
  return { projectKey: match[1].toUpperCase(), number };
}

/** Upper-case only in running text, so "utf-8" or "abc-1" in prose are not references. */
const REF_PATTERN = /\b([A-Z]{2,5})-(\d{1,10})\b/g;

export type RefSegment =
  { kind: "text"; text: string } | { kind: "ref"; text: string; ref: IssueRef };

/**
 * Splits text into plain runs and issue references. Only keys of known projects count, so
 * "UTF-8" or "SHA-256" stay plain text.
 */
export function splitIssueRefs(text: string, projectKeys: readonly string[]): RefSegment[] {
  const known = new Set(projectKeys);
  const segments: RefSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(REF_PATTERN)) {
    const [whole, key, digits] = match;
    if (!key || !digits || !known.has(key)) continue;
    const number = Number(digits);
    if (number < 1 || number > MAX_ISSUE_NUMBER) continue;
    const start = match.index;
    if (start > last) segments.push({ kind: "text", text: text.slice(last, start) });
    segments.push({ kind: "ref", text: whole, ref: { projectKey: key, number } });
    last = start + whole.length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/** Unique references in order of first appearance (ISS-7, DOC-9). */
export function extractIssueRefs(text: string, projectKeys: readonly string[]): IssueRef[] {
  const seen = new Set<string>();
  const refs: IssueRef[] = [];
  for (const segment of splitIssueRefs(text, projectKeys)) {
    if (segment.kind !== "ref") continue;
    const key = formatIssueKey(segment.ref.projectKey, segment.ref.number);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(segment.ref);
  }
  return refs;
}

const MAX_SLUG_LENGTH = 40;

/** Lower-case ASCII words joined by "-", cut at a word boundary to at most 40 characters. */
export function slugify(title: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining accents: "Café" → "Cafe"
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > MAX_SLUG_LENGTH) {
      // A single over-long first word is truncated rather than dropped.
      if (!slug) slug = word.slice(0, MAX_SLUG_LENGTH);
      break;
    }
    slug = next;
  }
  return slug;
}

/** GH-5: `stk-123-short-title`, which GH-2 later matches back to the issue. */
export function branchName(issueKey: string, title: string): string {
  const slug = slugify(title);
  const key = issueKey.toLowerCase();
  return slug ? `${key}-${slug}` : key;
}
