import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";

/**
 * VW-5: the board and the backlog remember their last view (the query string: sprint,
 * types, hidden columns, filters, group) per browser, and the app's links to them (sidebar,
 * command palette) open it again. Pure helpers; storage lives in `features/views/last-view`.
 */

/** The pages that remember their view. */
export const REMEMBERED_SECTIONS = ["board", "backlog"] as const;

/** Upper bound on a stored query; anything longer is dropped, not truncated. */
export const LAST_VIEW_QUERY_MAX = 2000;

const STORAGE_PREFIX = "hq.last-view:";

/**
 * The storage key for a remembered page (`/STK/board`, `/STK/backlog`), or null for any
 * other path. The project key is part of it, so each project keeps its own view.
 */
export function lastViewKey(pathname: string): string | null {
  const [, projectKey, section, ...rest] = pathname.split("/");
  if (rest.length > 0 || !projectKey || !PROJECT_KEY_PATTERN.test(projectKey)) return null;
  if (!REMEMBERED_SECTIONS.some((name) => name === section)) return null;
  return `${STORAGE_PREFIX}/${projectKey}/${section}`;
}

/** A stored query as it is safe to put back on a URL ("" when there is nothing usable). */
export function cleanStoredQuery(stored: string | null): string {
  if (!stored || stored.length > LAST_VIEW_QUERY_MAX) return "";
  // Re-encoded through URLSearchParams, so only a query string can come back out.
  return new URLSearchParams(stored.replace(/^\?/, "")).toString();
}

/** `href` with the remembered query, or `href` itself when there is none. */
export function withStoredQuery(href: string, stored: string | null): string {
  if (href.includes("?") || href.includes("#")) return href;
  const query = cleanStoredQuery(stored);
  return query ? `${href}?${query}` : href;
}
