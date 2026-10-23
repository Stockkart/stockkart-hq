import { type DocType } from "./constants";
import { formatAdrNumber, splitAdrTitle } from "./adr";

/**
 * Where a doc lives in the `Stockkart/engineering-handbook` repo (DOC-12 export file name,
 * DOC-14 publish/pull). Isomorphic and pure.
 *
 * Precedence: `docs.handbook_path` (an explicit override) → `docs.source_path` (where the
 * import found it) → a default from the doc: ADRs `decisions/NNNN-<slug>.md`, everything
 * else `<UPPER_SNAKE_TITLE>.md` at the top level (the handbook's style: `ARCHITECTURE.md`,
 * `RUNBOOK.md`). A stored path that breaks the rules below is skipped, never used.
 *
 * Rules (the same regex backs CHECKs on `docs.handbook_path` and
 * `handbook_publication_docs.path`): relative (no leading `/`), `/`-separated segments of
 * ASCII letters, digits, `_`, `-` and `.`, no segment starting with `.` (so no `..`, no
 * `.github/…`), no `..` anywhere, lower-case `.md` only, at most 200 characters. HQ writes
 * these paths into a public repo through a GitHub App, so nothing outside the handbook's
 * Markdown files is reachable.
 */

export const HANDBOOK_PATH_MAX = 200;
export const HANDBOOK_SLUG_MAX = 60;
export const HANDBOOK_DECISIONS_DIR = "decisions";

/** Shared with the SQL CHECKs (POSIX regex, so no `\d` or lookarounds). */
export const HANDBOOK_PATH_REGEX_SOURCE =
  "^([A-Za-z0-9_-][A-Za-z0-9_.-]*/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*[.]md$";
const HANDBOOK_PATH_PATTERN = new RegExp(HANDBOOK_PATH_REGEX_SOURCE);

export function isHandbookPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= HANDBOOK_PATH_MAX &&
    !value.includes("..") &&
    HANDBOOK_PATH_PATTERN.test(value)
  );
}

/** ASCII words of a title: accents folded (`é` → `e`), everything else a separator. */
function asciiWords(title: string): string[] {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "");
}

/** Joins words up to `max` characters, cutting at a word boundary when one fits. */
function joinWithin(words: string[], separator: string, max: number): string {
  let out = "";
  for (const word of words) {
    const next = out ? `${out}${separator}${word}` : word;
    if (next.length > max) return out || word.slice(0, max);
    out = next;
  }
  return out;
}

/** `Use a queue for OCR!` → `use-a-queue-for-ocr` (ASCII kebab, ≤ 60 chars). */
export function handbookSlug(title: string): string {
  return joinWithin(asciiWords(title.toLowerCase()), "-", HANDBOOK_SLUG_MAX) || "untitled";
}

/** `In-memory state` → `IN_MEMORY_STATE` (≤ 60 chars). */
export function handbookUpperSnake(title: string): string {
  return joinWithin(asciiWords(title.toUpperCase()), "_", HANDBOOK_SLUG_MAX) || "UNTITLED";
}

export interface HandbookPathDoc {
  type: DocType;
  title: string;
  adrNumber: number | null;
  handbookPath?: string | null;
  sourcePath?: string | null;
}

/** The default path of a doc that has none stored. */
export function defaultHandbookPath(doc: Omit<HandbookPathDoc, "handbookPath" | "sourcePath">) {
  if (doc.type === "adr") {
    // "0011. Delete migrations" → slug of "Delete migrations".
    const title = splitAdrTitle(doc.title)?.title ?? doc.title;
    const prefix = doc.adrNumber !== null ? `${formatAdrNumber(doc.adrNumber)}-` : "";
    return `${HANDBOOK_DECISIONS_DIR}/${prefix}${handbookSlug(title)}.md`;
  }
  return `${handbookUpperSnake(doc.title)}.md`;
}

/** The doc's repo path (see the module comment for precedence); always a valid path. */
export function handbookPathFor(doc: HandbookPathDoc): string {
  if (isHandbookPath(doc.handbookPath)) return doc.handbookPath;
  if (isHandbookPath(doc.sourcePath)) return doc.sourcePath;
  return defaultHandbookPath(doc);
}

/** `decisions/0004-ocr.md` → `0004-ocr.md`. */
export function handbookFileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The link from one handbook file to another: `0010-x.md` within `decisions/`. */
export function handbookRelativeLink(from: string, to: string): string {
  const fromDir = from.split("/").slice(0, -1);
  const toParts = to.split("/");
  let common = 0;
  while (
    common < fromDir.length &&
    common < toParts.length - 1 &&
    fromDir[common] === toParts[common]
  ) {
    common += 1;
  }
  return [...fromDir.slice(common).map(() => ".."), ...toParts.slice(common)].join("/");
}
