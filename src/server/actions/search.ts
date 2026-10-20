"use server";

import { type ActionResult } from "@/lib/action-result";
import { type SearchResults, searchInput } from "@/lib/search/schemas";
import { requireSession } from "@/server/auth/require-session";
import { searchService } from "@/server/services";

import { runAction } from "./action-runner";

/**
 * SRCH-1/2 ⌘K search. Session first (S-2); the query is trimmed and capped at
 * `SEARCH_QUERY_MAX` characters by `searchInput` before it reaches Postgres. The palette
 * debounces keystrokes (`SEARCH_DEBOUNCE_MS`) and drops stale responses, so typing sends
 * one request per pause rather than one per key. Read-only: refreshes nothing.
 */
export async function searchAction(input: unknown): Promise<ActionResult<SearchResults>> {
  await requireSession();
  return runAction(
    searchInput,
    input,
    (data) => searchService.search(data.q),
    () => {},
  );
}
