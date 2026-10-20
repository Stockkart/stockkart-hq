/**
 * Calendar-date helpers for sprints. Sprint dates are Postgres `date`s, handled as ISO
 * `YYYY-MM-DD` strings and computed in UTC so the result never depends on the host's zone.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * DAY_MS);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** Every date from `start` to `end`, both included; empty when `end` is before `start`. */
export function datesInRange(start: string, end: string): string[] {
  const count = daysBetween(start, end) + 1;
  return Array.from({ length: Math.max(0, count) }, (_, index) => addDays(start, index));
}

/** The UTC calendar date of an instant. */
export const isoDateOf = (date: Date) => date.toISOString().slice(0, 10);

/** The last millisecond of a UTC calendar date. */
export const endOfDay = (iso: string) => new Date(toUtc(iso) + DAY_MS - 1);

const SHORT = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Jun 2", for chart axes and section headers. */
export const formatShortDate = (iso: string) => SHORT.format(new Date(toUtc(iso)));

/** "Jun 2 – Jun 15", or "No dates". */
export function formatDateRange(start: string | null, end: string | null): string {
  if (!start && !end) return "No dates";
  return `${start ? formatShortDate(start) : "?"} – ${end ? formatShortDate(end) : "?"}`;
}

/**
 * SPR-1 create-dialog defaults: "Sprint N" (N = sprints so far + 1), starting the day after
 * the latest sprint ends (or today), lasting the project's sprint length.
 */
export function nextSprintDefaults(
  sprints: readonly { endDate: string | null }[],
  sprintLengthDays: number,
  today: string,
): { name: string; startDate: string; endDate: string } {
  const lastEnd = sprints
    .map((sprint) => sprint.endDate)
    .filter((date): date is string => date !== null)
    .sort()
    .at(-1);
  const startDate = lastEnd ? addDays(lastEnd, 1) : today;
  return {
    name: `Sprint ${sprints.length + 1}`,
    startDate,
    endDate: addDays(startDate, Math.max(1, sprintLengthDays) - 1),
  };
}
