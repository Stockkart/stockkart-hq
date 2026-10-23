/**
 * RDM-1/RDM-2 roadmap vocabulary. Isomorphic: the page parses its URL with it and the
 * timeline draws with it.
 */

/** Timeline zoom levels, narrowest first. */
export const ROADMAP_ZOOMS = ["week", "month", "quarter"] as const;
export type RoadmapZoom = (typeof ROADMAP_ZOOMS)[number];
export const DEFAULT_ZOOM: RoadmapZoom = "month";

export const ZOOM_LABELS: Record<RoadmapZoom, string> = {
  week: "Weeks",
  month: "Months",
  quarter: "Quarters",
};

/** Width of one day on the timeline, per zoom. */
export const DAY_WIDTH: Record<RoadmapZoom, number> = { week: 28, month: 8, quarter: 3 };

/** Height of one epic row (bars and dependency arrows are laid out on it). */
export const ROW_HEIGHT = 44;

/** Keyboard: Shift+arrow moves a bar by this many days. */
export const WEEK_DAYS = 7;

/** Wait after the last arrow key before saving, so holding a key saves (and logs) once. */
export const KEYBOARD_SAVE_DELAY_MS = 700;
