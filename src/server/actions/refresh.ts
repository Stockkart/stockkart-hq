import { revalidatePath } from "next/cache";

/**
 * Which pages a mutation refreshes. Not a server action (no "use server"), so it can never
 * be called from the browser.
 *
 * Route patterns, each revalidated as a page: only the pages that show the changed data are
 * marked stale (previously every page under `/[projectKey]` was). The page the user is on is
 * re-rendered in the action's own response; the client shows the change optimistically
 * before that arrives, so nothing waits on it.
 */

export const ISSUE_LIST = "/[projectKey]/issues";
export const ISSUE_PAGE = "/[projectKey]/issues/[key]";
export const BACKLOG = "/[projectKey]/backlog";
export const BOARD = "/[projectKey]/board";
export const MY_WORK = "/my-work";
/** Doc pages list their linked issues with title, status and priority (DOC-9). */
export const DOC_PAGE = "/[projectKey]/docs/[id]";
export const TODOS = "/todos";
/** The ADR log lists the keys of the (live) issues each ADR links to. */
export const ADR_LOG = "/[projectKey]/adrs";

/** Every page that lists or shows issue fields. */
export const ISSUE_VIEWS = [ISSUE_LIST, ISSUE_PAGE, BACKLOG, BOARD, MY_WORK] as const;

export function refreshPages(...patterns: readonly string[]): void {
  for (const pattern of new Set(patterns)) revalidatePath(pattern, "page");
}
