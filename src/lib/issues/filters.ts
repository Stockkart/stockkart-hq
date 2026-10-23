import { z } from "zod";

import { ISSUE_TYPES, type IssueType, type Priority, PRIORITIES } from "./constants";

/**
 * VW-1/VW-2 issue filters and sorting, kept in the URL so a filtered view is shareable.
 * Isomorphic: the server parses `searchParams` with it, the filter bar writes URLs with it.
 *
 * URL format: one parameter per dimension, values comma-separated, e.g.
 * `?type=bug,task&priority=0,1&assignee=me,none&q=outbox&sort=priority&dir=asc`.
 * Parsing never fails: an unknown parameter, a malformed value or a value of the wrong
 * shape is dropped, so a hand-edited or outdated link still opens (with fewer filters).
 */

export const TEXT_FILTER_MAX = 200;
/** More values than this per dimension is not a real filter; the rest are ignored. */
const MAX_VALUES = 50;

/** `none` = unassigned; `me` = the signed-in user (resolved on the server). */
export const ASSIGNEE_NONE = "none";
export const ASSIGNEE_ME = "me";
export type AssigneeFilter = string;
/** REL-1 fix-version filter: `none` = issues without a fix version. */
export const RELEASE_NONE = "none";

export interface IssueFilters {
  types: IssueType[];
  statuses: string[];
  priorities: Priority[];
  assignees: AssigneeFilter[];
  components: string[];
  labels: string[];
  /** REL-1 fix versions (`release=<id>,none`): release ids or `RELEASE_NONE`. */
  releases: string[];
  text: string;
}

export const EMPTY_FILTERS: IssueFilters = {
  types: [],
  statuses: [],
  priorities: [],
  assignees: [],
  components: [],
  labels: [],
  releases: [],
  text: "",
};

export const ISSUE_SORT_KEYS = [
  "key",
  "type",
  "title",
  "status",
  "priority",
  "assignee",
  "points",
  "created",
  "updated",
] as const;
export type IssueSortKey = (typeof ISSUE_SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";

export interface IssueSort {
  by: IssueSortKey;
  dir: SortDirection;
}

/** The list's default: newest first (what slice 1 showed). */
export const DEFAULT_SORT: IssueSort = { by: "created", dir: "desc" };

/** BLG-2 backlog grouping. */
export const BACKLOG_GROUPS = ["none", "epic", "component", "assignee"] as const;
export type BacklogGroup = (typeof BACKLOG_GROUPS)[number];

/** What Next.js passes as `searchParams`, or a URLSearchParams from the browser. */
export type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function rawValues(params: RawParams, name: string): string[] {
  const raw = params instanceof URLSearchParams ? params.getAll(name) : params[name];
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return list.flatMap((value) => value.split(",")).map((value) => value.trim());
}

/** Values of one parameter that pass `schema`, de-duplicated, in order. */
function listParam<T>(params: RawParams, name: string, schema: z.ZodType<T>): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of rawValues(params, name)) {
    if (!value || seen.has(value)) continue;
    const parsed = schema.safeParse(value);
    if (!parsed.success) continue;
    seen.add(value);
    result.push(parsed.data);
    if (result.length >= MAX_VALUES) break;
  }
  return result;
}

function singleParam(params: RawParams, name: string): string | undefined {
  const raw = params instanceof URLSearchParams ? params.get(name) : params[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? undefined;
}

const uuid = z.uuid();
const issueType = z.enum(ISSUE_TYPES);
const priority = z
  .string()
  .regex(/^\d$/)
  .transform(Number)
  .pipe(z.literal([...PRIORITIES]));
const assignee = z.union([z.literal(ASSIGNEE_NONE), z.literal(ASSIGNEE_ME), uuid]);
const release = z.union([z.literal(RELEASE_NONE), uuid]);

export function parseIssueFilters(params: RawParams): IssueFilters {
  const text = (singleParam(params, "q") ?? "").replace(/\s+/g, " ").trim();
  return {
    types: listParam(params, "type", issueType),
    statuses: listParam(params, "status", uuid),
    priorities: listParam(params, "priority", priority),
    assignees: listParam(params, "assignee", assignee),
    components: listParam(params, "component", uuid),
    labels: listParam(params, "label", uuid),
    releases: listParam(params, "release", release),
    // Over-long text is ignored rather than cut, like every other invalid value.
    text: text.length <= TEXT_FILTER_MAX ? text : "",
  };
}

export function parseIssueSort(params: RawParams, fallback: IssueSort = DEFAULT_SORT): IssueSort {
  const by = z.enum(ISSUE_SORT_KEYS).safeParse(singleParam(params, "sort"));
  if (!by.success) return fallback;
  const dir = z.enum(["asc", "desc"]).safeParse(singleParam(params, "dir"));
  return { by: by.data, dir: dir.success ? dir.data : "asc" };
}

export function parseBacklogGroup(params: RawParams): BacklogGroup {
  const parsed = z.enum(BACKLOG_GROUPS).safeParse(singleParam(params, "group"));
  return parsed.success ? parsed.data : "none";
}

export function hasActiveFilters(filters: IssueFilters): boolean {
  return (
    filters.text !== "" ||
    filters.types.length > 0 ||
    filters.statuses.length > 0 ||
    filters.priorities.length > 0 ||
    filters.assignees.length > 0 ||
    filters.components.length > 0 ||
    filters.labels.length > 0 ||
    filters.releases.length > 0
  );
}

/**
 * The URL query for `filters` (plus `extra` params such as sort or group, written only when
 * set). Defaults are omitted so the plain page URL stays clean.
 */
export function filtersToSearchParams(
  filters: IssueFilters,
  extra: Record<string, string | undefined> = {},
): URLSearchParams {
  const params = new URLSearchParams();
  const lists: [string, readonly (string | number)[]][] = [
    ["type", filters.types],
    ["status", filters.statuses],
    ["priority", filters.priorities],
    ["assignee", filters.assignees],
    ["component", filters.components],
    ["label", filters.labels],
    ["release", filters.releases],
  ];
  for (const [name, values] of lists) {
    if (values.length > 0) params.set(name, values.join(","));
  }
  if (filters.text) params.set("q", filters.text);
  for (const [name, value] of Object.entries(extra)) {
    if (value) params.set(name, value);
  }
  return params;
}
