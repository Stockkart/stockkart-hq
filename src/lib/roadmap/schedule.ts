import { addDays, daysBetween } from "@/lib/sprints/dates";

import { WEEK_DAYS } from "./constants";
import { type DateRange } from "./views";

/**
 * RDM-1 bar edits as pure date math (ISO `YYYY-MM-DD`, UTC; see `lib/sprints/dates`). A
 * pointer drag and the keyboard both end up here, so they behave the same: a move keeps
 * the length, a resize never puts the end before the start (a bar is at least one day).
 */

export type BarEdit =
  | { kind: "move"; days: number }
  | { kind: "resizeStart"; days: number }
  | { kind: "resizeEnd"; days: number };

export function applyBarEdit(range: DateRange, edit: BarEdit): DateRange {
  switch (edit.kind) {
    case "move":
      return { start: addDays(range.start, edit.days), end: addDays(range.end, edit.days) };
    case "resizeStart": {
      const start = addDays(range.start, edit.days);
      return { start: daysBetween(start, range.end) < 0 ? range.end : start, end: range.end };
    }
    case "resizeEnd": {
      const end = addDays(range.end, edit.days);
      return { start: range.start, end: daysBetween(range.start, end) < 0 ? range.start : end };
    }
  }
}

/**
 * The keyboard alternative to dragging a focused bar: ←/→ move it by a day, Shift by a
 * week; Alt+←/→ moves its end date instead (Alt+Shift by a week). Null for any other key.
 */
export function keyboardBarEdit(event: {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): BarEdit | null {
  if (event.ctrlKey || event.metaKey) return null;
  const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  if (direction === 0) return null;
  const days = direction * (event.shiftKey ? WEEK_DAYS : 1);
  return event.altKey ? { kind: "resizeEnd", days } : { kind: "move", days };
}

/** Whole days a pointer moved, snapped to the nearest day. */
export function dragDays(deltaPx: number, dayWidth: number): number {
  return Math.round(deltaPx / dayWidth) || 0;
}

export const sameRange = (a: DateRange, b: DateRange) => a.start === b.start && a.end === b.end;

/** Days a range covers, both ends included. */
export const rangeDays = (range: DateRange) => daysBetween(range.start, range.end) + 1;
