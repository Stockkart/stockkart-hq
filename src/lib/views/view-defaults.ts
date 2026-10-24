import { z } from "zod";

import { ISSUE_TYPES, type IssueType } from "@/lib/issues/constants";
import {
  filtersToSearchParams,
  type IssueFilters,
  type RawParams,
  rawValues,
} from "@/lib/issues/filters";
import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";

/**
 * BRD-6 / VW-4 view defaults: per project, the issue types the board and the issue list show
 * and the statuses they hide when the URL says nothing else (`projects.board_*` /
 * `projects.list_*`, migration 0008). Isomorphic: the pages resolve them on the server, the
 * board toolbar, the filter bar and the settings tab write URLs and saves with them.
 *
 * A "view" here is `{ types, hidden }`: `types` empty = every type; `hidden` = status ids,
 * only current statuses, in workflow order, and never all of them (at least one column or
 * status stays visible; a view that would hide every status shows them all instead).
 */

/** Most values in one stored array (the `projects_*_size` CHECKs). */
export const VIEW_DEFAULT_ARRAY_MAX = 20;

/** As stored: `issueTypes` null = every type. */
export interface ViewDefaults {
  issueTypes: IssueType[] | null;
  hiddenStatusIds: string[];
}

export interface ProjectViewDefaults {
  board: ViewDefaults;
  list: ViewDefaults;
}

export const NO_VIEW_DEFAULTS: ViewDefaults = { issueTypes: null, hiddenStatusIds: [] };

export interface ResolvedView {
  /** Empty = every type. Canonical order (`ISSUE_TYPES`). */
  types: IssueType[];
  /** Hidden status ids in workflow order; never every status. */
  hidden: string[];
}

/** Canonical form: known types in `ISSUE_TYPES` order (all of them = none), known statuses. */
export function normaliseView(
  view: { types: readonly IssueType[]; hidden: readonly string[] },
  statusIds: readonly string[],
): ResolvedView {
  const types = ISSUE_TYPES.filter((type) => view.types.includes(type));
  const hidden = statusIds.filter((id) => view.hidden.includes(id));
  return {
    types: types.length === ISSUE_TYPES.length ? [] : types,
    hidden: hidden.length >= statusIds.length ? [] : hidden,
  };
}

export function resolveDefaults(
  defaults: ViewDefaults,
  statusIds: readonly string[],
): ResolvedView {
  return normaliseView(
    { types: defaults.issueTypes ?? [], hidden: defaults.hiddenStatusIds },
    statusIds,
  );
}

const sameList = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((value) => b.includes(value));

/** Same types and hidden statuses (both normalised). */
export function sameView(a: ResolvedView, b: ResolvedView): boolean {
  return sameList(a.types, b.types) && sameList(a.hidden, b.hidden);
}

/** What the save action stores for a view (`[]` types = every type = null). */
export function viewDefaultsOf(view: ResolvedView): ViewDefaults {
  return {
    issueTypes: view.types.length > 0 ? view.types : null,
    hiddenStatusIds: view.hidden,
  };
}

const issueType = z.enum(ISSUE_TYPES);
const uuid = z.uuid();
const MAX_URL_VALUES = 50;

function present(params: RawParams, name: string): boolean {
  return params instanceof URLSearchParams ? params.has(name) : params[name] !== undefined;
}

function valid<T>(params: RawParams, name: string, schema: z.ZodType<T>): T[] {
  const result: T[] = [];
  for (const value of rawValues(params, name)) {
    const parsed = schema.safeParse(value);
    if (parsed.success && !result.includes(parsed.data)) result.push(parsed.data);
    if (result.length >= MAX_URL_VALUES) break;
  }
  return result;
}

// ── Board (BRD-6) ────────────────────────────────────────────────────────────────────────

/** `?types=task,bug` (or `all`) and `?hide=<statusId>,…` (or `none`). */
export const BOARD_TYPES_PARAM = "types";
export const BOARD_HIDE_PARAM = "hide";
export const ALL_TYPES_VALUE = "all";
export const NO_HIDDEN_VALUE = "none";

/** What the board URL says; null = not in the URL, so the project default applies. */
export interface BoardViewParams {
  types: IssueType[] | null;
  hidden: string[] | null;
}

/**
 * Parses the board's view params. Never fails: unknown values are ignored, so `types=all`,
 * `types=` or `types=nonsense` all mean "every type" (the param is there, naming none), and
 * likewise `hide=none` means "no hidden columns".
 */
export function parseBoardViewParams(params: RawParams): BoardViewParams {
  return {
    types: present(params, BOARD_TYPES_PARAM) ? valid(params, BOARD_TYPES_PARAM, issueType) : null,
    hidden: present(params, BOARD_HIDE_PARAM) ? valid(params, BOARD_HIDE_PARAM, uuid) : null,
  };
}

export function resolveBoardView(
  params: BoardViewParams,
  defaults: ViewDefaults,
  statusIds: readonly string[],
): ResolvedView {
  const base = resolveDefaults(defaults, statusIds);
  return normaliseView(
    { types: params.types ?? base.types, hidden: params.hidden ?? base.hidden },
    statusIds,
  );
}

/**
 * The board's query for `view`: a dimension equal to the default is left out (so the plain
 * URL follows the project defaults), an empty one is written as `all` / `none`. `extra`
 * params (the scope) come first.
 */
export function boardViewQuery(
  view: ResolvedView,
  defaults: ResolvedView,
  extra: Record<string, string | undefined> = {},
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(extra)) {
    if (value) params.set(name, value);
  }
  if (!sameList(view.types, defaults.types)) {
    params.set(BOARD_TYPES_PARAM, view.types.length > 0 ? view.types.join(",") : ALL_TYPES_VALUE);
  }
  if (!sameList(view.hidden, defaults.hidden)) {
    params.set(BOARD_HIDE_PARAM, view.hidden.length > 0 ? view.hidden.join(",") : NO_HIDDEN_VALUE);
  }
  return params;
}

// ── Issue list (VW-4) ────────────────────────────────────────────────────────────────────

/** `?type=all` on the list: "every type and status", overriding the project defaults. */
export const LIST_ALL_VALUE = "all";

/**
 * VW-4: the list starts from the project defaults only when the URL names no type and no
 * status, and no saved view is open (`openView`; a saved view's own filters win).
 */
export function listUsesDefaults(params: RawParams, openView: boolean): boolean {
  return !openView && !present(params, "type") && !present(params, "status");
}

/** The list defaults as filter values: types, and the statuses shown (empty = all). */
export interface ListDefaultFilters {
  types: IssueType[];
  statuses: string[];
}

export function listDefaultFilters(
  defaults: ViewDefaults,
  statusIds: readonly string[],
): ListDefaultFilters {
  const view = resolveDefaults(defaults, statusIds);
  return {
    types: view.types,
    statuses: view.hidden.length > 0 ? statusIds.filter((id) => !view.hidden.includes(id)) : [],
  };
}

/** The list filters' types and statuses as a view (statuses not picked = hidden). */
export function listViewOf(
  filters: Pick<IssueFilters, "types" | "statuses">,
  statusIds: readonly string[],
): ResolvedView {
  return normaliseView(
    {
      types: filters.types,
      hidden:
        filters.statuses.length > 0 ? statusIds.filter((id) => !filters.statuses.includes(id)) : [],
    },
    statusIds,
  );
}

/** What the filter bar and the list's sort links need to write list URLs (VW-4). */
export interface ListDefaultsContext extends ListDefaultFilters {
  /** Every status id, in workflow order (to turn the shown statuses into hidden ones). */
  statusIds: string[];
  /**
   * Leave the defaults out of URLs (they apply again on the plain URL). False while a saved
   * view is open: its URL carries `view=`, so defaults never apply and every filter is
   * written out.
   */
  canonical: boolean;
}

/**
 * The list query for `filters`: types and statuses equal to the defaults are left out (the
 * plain URL applies them again), and with no type and no status picked, when the defaults
 * would narrow the list, `type=all` keeps it unfiltered.
 */
export function listFiltersQuery(
  filters: IssueFilters,
  defaults: ListDefaultsContext | null,
  extra: Record<string, string | undefined> = {},
): URLSearchParams {
  if (!defaults?.canonical) return filtersToSearchParams(filters, extra);
  if (sameList(filters.types, defaults.types) && sameList(filters.statuses, defaults.statuses)) {
    return filtersToSearchParams({ ...filters, types: [], statuses: [] }, extra);
  }
  const params = filtersToSearchParams(filters, extra);
  if (filters.types.length === 0 && filters.statuses.length === 0) {
    return new URLSearchParams([["type", LIST_ALL_VALUE], ...params]);
  }
  return params;
}

// ── Saving (settings tab, board toolbar, filter bar) ────────────────────────────────────

const viewDefaultsInput = z.object({
  /** Null or empty = every type; every type listed is stored as null too. */
  issueTypes: z
    .array(issueType)
    .max(VIEW_DEFAULT_ARRAY_MAX)
    .nullable()
    .transform((types) => {
      const known = ISSUE_TYPES.filter((type) => types?.includes(type));
      return known.length === 0 || known.length === ISSUE_TYPES.length ? null : known;
    }),
  hiddenStatusIds: z
    .array(uuid)
    .max(VIEW_DEFAULT_ARRAY_MAX, `Hide at most ${VIEW_DEFAULT_ARRAY_MAX} statuses`)
    .transform((ids) => [...new Set(ids)]),
});

/** Saves the board and/or the list defaults; at least one of them. */
export const saveViewDefaultsInput = z
  .object({
    projectKey: z.string().regex(PROJECT_KEY_PATTERN),
    board: viewDefaultsInput.optional(),
    list: viewDefaultsInput.optional(),
  })
  .refine((value) => value.board !== undefined || value.list !== undefined, "Nothing to save");

export const KEEP_ONE_VISIBLE_MESSAGE = "Keep at least one status visible";
