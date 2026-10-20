import { z } from "zod";

import { type Snippet } from "./snippet";

/** SRCH-1/2 command-palette search. Isomorphic. */

export const SEARCH_QUERY_MAX = 200;
/** Results per group (issues, docs, comments). */
export const SEARCH_GROUP_LIMIT = 5;
/** Client-side wait after the last keystroke before searching. */
export const SEARCH_DEBOUNCE_MS = 200;

export const searchInput = z.object({
  q: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(SEARCH_QUERY_MAX, "Search text is too long")),
});

export type SearchKind = "issue" | "doc" | "comment";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  href: string;
  /** e.g. `STK-12 Add outbox` or `ADR-0008 Scheduled outbox dispatch`. */
  title: string;
  /** Where a comment was written, e.g. `STK-12`. */
  context: string | null;
  snippet: Snippet | null;
}

export interface SearchResults {
  /** Set when the query is an existing issue key (`STK-123` jumps directly). */
  jump: { key: string; title: string; href: string } | null;
  issues: SearchHit[];
  docs: SearchHit[];
  comments: SearchHit[];
}

export const EMPTY_RESULTS: SearchResults = { jump: null, issues: [], docs: [], comments: [] };
