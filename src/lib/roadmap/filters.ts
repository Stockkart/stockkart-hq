import { z } from "zod";

import { STATUS_CATEGORIES, type StatusCategory } from "@/lib/issues/constants";
import { ASSIGNEE_ME, ASSIGNEE_NONE, type RawParams } from "@/lib/issues/filters";

import { DEFAULT_ZOOM, ROADMAP_ZOOMS, type RoadmapZoom } from "./constants";

/**
 * RDM-1 roadmap view state, kept in the URL so a filtered roadmap is shareable:
 * `?zoom=week&component=<id>,<id>&assignee=me,none,<id>&category=todo,in_progress`.
 * Like the issue filters, parsing never fails: invalid values are dropped.
 */

export interface RoadmapFilters {
  components: string[];
  /** User ids, `me` or `none` (unassigned). */
  assignees: string[];
  categories: StatusCategory[];
}

export interface RoadmapParams {
  zoom: RoadmapZoom;
  filters: RoadmapFilters;
}

export const EMPTY_ROADMAP_FILTERS: RoadmapFilters = {
  components: [],
  assignees: [],
  categories: [],
};

const MAX_VALUES = 50;
const uuid = z.uuid();
const assignee = z.union([z.literal(ASSIGNEE_NONE), z.literal(ASSIGNEE_ME), uuid]);
const category = z.enum(STATUS_CATEGORIES);

function values(params: RawParams, name: string): string[] {
  const raw = params instanceof URLSearchParams ? params.getAll(name) : params[name];
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return list.flatMap((value) => value.split(",")).map((value) => value.trim());
}

function listParam<T extends string>(params: RawParams, name: string, schema: z.ZodType<T>): T[] {
  const result: T[] = [];
  for (const value of values(params, name)) {
    const parsed = schema.safeParse(value);
    if (!parsed.success || result.includes(parsed.data)) continue;
    result.push(parsed.data);
    if (result.length >= MAX_VALUES) break;
  }
  return result;
}

export function parseRoadmapParams(params: RawParams): RoadmapParams {
  const zoom = z.enum(ROADMAP_ZOOMS).safeParse(values(params, "zoom")[0]);
  return {
    zoom: zoom.success ? zoom.data : DEFAULT_ZOOM,
    filters: {
      components: listParam(params, "component", uuid),
      assignees: listParam(params, "assignee", assignee),
      categories: listParam(params, "category", category),
    },
  };
}

export function hasRoadmapFilters(filters: RoadmapFilters): boolean {
  return (
    filters.components.length > 0 || filters.assignees.length > 0 || filters.categories.length > 0
  );
}

/** The query string for `params`; the default zoom and empty filters are left out. */
export function roadmapSearchParams({ zoom, filters }: RoadmapParams): URLSearchParams {
  const params = new URLSearchParams();
  if (zoom !== DEFAULT_ZOOM) params.set("zoom", zoom);
  const lists: [string, readonly string[]][] = [
    ["component", filters.components],
    ["assignee", filters.assignees],
    ["category", filters.categories],
  ];
  for (const [name, list] of lists) if (list.length > 0) params.set(name, list.join(","));
  return params;
}
