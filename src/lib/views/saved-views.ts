import { z } from "zod";

import {
  DEFAULT_SORT,
  filtersToSearchParams,
  parseIssueFilters,
  parseIssueSort,
  type RawParams,
} from "@/lib/issues/filters";
import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";

/**
 * VW-3 saved views: a name for an issue-list URL (its filters and sort, VW-2). Isomorphic:
 * the issue list saves the URL it shows, the sidebar links to it, the server re-parses it.
 *
 * The stored `filter` is the URL's query as a flat record (`{ type: "bug", priority: "0,1" }`),
 * always produced by `viewFilterOf`, so only parameters the list understands are kept, in
 * their canonical form. `assignee=me` stays `me`: a shared "My open bugs" shows each
 * person their own.
 */

export const VIEW_NAME_MAX = 60;
/** Longer than any real filter URL (50 values per dimension, see `filters.ts`). */
export const VIEW_QUERY_MAX = 8000;
/** The URL parameter that marks the open view on the issue list. */
export const VIEW_PARAM = "view";

export type ViewFilter = Record<string, string>;

/** The canonical filter record of a query string or Next.js `searchParams`. */
export function viewFilterOf(params: RawParams): ViewFilter {
  const filters = parseIssueFilters(params);
  const sort = parseIssueSort(params);
  const extra = sort === DEFAULT_SORT ? {} : { sort: sort.by, dir: sort.dir };
  return Object.fromEntries(filtersToSearchParams(filters, extra));
}

/** A stored filter, re-parsed (a value the list no longer understands is dropped). */
export function parseStoredFilter(value: unknown): ViewFilter {
  const parsed = z.record(z.string(), z.string()).safeParse(value);
  return parsed.success ? viewFilterOf(new URLSearchParams(parsed.data)) : {};
}

/** Same filters and sort (order of parameters aside). */
export function sameFilter(a: ViewFilter, b: ViewFilter): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
}

/** The issue-list URL of a view: its filters, plus `view=<id>` so the list knows it. */
export function viewHref(projectKey: string, view: { id: string; filter: ViewFilter }): string {
  const params = new URLSearchParams(view.filter);
  params.set(VIEW_PARAM, view.id);
  return `/${projectKey}/issues?${params.toString()}`;
}

/** A saved view as the sidebar and the issue list see it. */
export interface SavedViewItem {
  id: string;
  name: string;
  shared: boolean;
  /** The signed-in user's own view (only those can be changed or reordered). */
  mine: boolean;
  ownerName: string | null;
  filter: ViewFilter;
}

const id = z.uuid();
const name = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Name the view").max(VIEW_NAME_MAX, "Name is too long"));
const query = z.string().max(VIEW_QUERY_MAX, "Too many filters to save");

export const saveViewInput = z.object({
  projectKey: z.string().regex(PROJECT_KEY_PATTERN),
  name,
  shared: z.boolean(),
  /** The issue list's current query string (`?` optional). */
  query,
});
export const updateViewFilterInput = z.object({ viewId: id, query });
export const renameViewInput = z.object({ viewId: id, name });
export const setViewSharedInput = z.object({ viewId: id, shared: z.boolean() });
export const viewIdInput = z.object({ viewId: id });
/** Sidebar order: put `viewId` right after `afterViewId` (null = first). */
export const moveViewInput = z
  .object({ viewId: id, afterViewId: id.nullable() })
  .refine((value) => value.viewId !== value.afterViewId, "A view cannot follow itself");
