import { addDays, daysBetween } from "@/lib/sprints/dates";

import { type RoadmapZoom } from "./constants";
import { type DateRange } from "./views";

/**
 * RDM-1 timeline geometry: which dates the timeline covers at a zoom level, and where its
 * header ticks go. Pure ISO date math in UTC, so the server and the browser agree.
 */

export interface Tick {
  date: string;
  label: string;
  /** Days from the window start. */
  offset: number;
}

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Monday of the ISO week of `date`. */
export function startOfWeek(date: string): string {
  const weekday = (toDate(date).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function startOfQuarter(date: string): string {
  const d = toDate(date);
  const month = Math.floor(d.getUTCMonth() / 3) * 3;
  return iso(new Date(Date.UTC(d.getUTCFullYear(), month, 1)));
}

export function addMonths(date: string, months: number): string {
  const d = toDate(date);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate())));
}

/** The first day of the unit (week, month, quarter) that contains `date`. */
function unitStart(date: string, zoom: RoadmapZoom): string {
  if (zoom === "week") return startOfWeek(date);
  if (zoom === "month") return startOfMonth(date);
  return startOfQuarter(date);
}

function nextUnit(date: string, zoom: RoadmapZoom): string {
  if (zoom === "week") return addDays(date, 7);
  return addMonths(date, zoom === "month" ? 1 : 3);
}

/** At least this many units are shown, so a short plan still fills a screen. */
const MIN_UNITS: Record<RoadmapZoom, number> = { week: 10, month: 6, quarter: 4 };

/**
 * The window: from one unit before the earliest date (bars and today) to one unit after the
 * latest, aligned to whole units. `end` is exclusive (the first day after the window).
 */
export function timelineWindow(
  ranges: readonly DateRange[],
  today: string,
  zoom: RoadmapZoom,
): { start: string; end: string; days: number } {
  let first = today;
  let last = today;
  for (const range of ranges) {
    if (range.start < first) first = range.start;
    if (range.end > last) last = range.end;
  }
  let start = unitStart(first, zoom);
  // One unit of room before the earliest date.
  start = zoom === "week" ? addDays(start, -7) : addMonths(start, zoom === "month" ? -1 : -3);
  let end = nextUnit(unitStart(last, zoom), zoom);
  end = nextUnit(end, zoom);
  let units = 0;
  for (let cursor = start; cursor < end; cursor = nextUnit(cursor, zoom)) units += 1;
  for (; units < MIN_UNITS[zoom]; units += 1) end = nextUnit(end, zoom);
  return { start, end, days: daysBetween(start, end) };
}

const MONTH = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("en", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

/** One tick per unit (Mondays, months or quarters), labelled for the header. */
export function timelineTicks(window: { start: string; end: string }, zoom: RoadmapZoom): Tick[] {
  const ticks: Tick[] = [];
  for (let date = window.start; date < window.end; date = nextUnit(date, zoom)) {
    const d = toDate(date);
    const label =
      zoom === "week"
        ? DAY.format(d)
        : zoom === "month"
          ? d.getUTCMonth() === 0 || ticks.length === 0
            ? MONTH_YEAR.format(d)
            : MONTH.format(d)
          : `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    ticks.push({ date, label, offset: daysBetween(window.start, date) });
  }
  return ticks;
}
