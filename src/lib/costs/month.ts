import { COST_TIMEZONE } from "./constants";

/**
 * Calendar months for costs as "YYYY-MM" strings (COST-2). An entry's `period` is the
 * first day of its month ("YYYY-MM-01", CHECK). Pure string / integer arithmetic: no Date
 * maths in local time, so a server in UTC and a browser in IST agree on every month.
 */

export type Month = `${number}-${string}`;

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

export function isMonth(value: unknown): value is Month {
  if (typeof value !== "string") return false;
  const match = MONTH_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  return year >= MIN_YEAR && year <= MAX_YEAR;
}

export function isYear(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_YEAR && value <= MAX_YEAR;
}

function parts(month: Month): { year: number; month: number } {
  const [year = "0", m = "0"] = month.split("-");
  return { year: Number(year), month: Number(m) };
}

function make(year: number, month: number): Month {
  return `${year}-${String(month).padStart(2, "0")}` as Month;
}

/** `delta` months later (negative: earlier). */
export function addMonths(month: Month, delta: number): Month {
  const { year, month: m } = parts(month);
  const index = year * 12 + (m - 1) + delta;
  return make(Math.floor(index / 12), (((index % 12) + 12) % 12) + 1);
}

export const previousMonth = (month: Month): Month => addMonths(month, -1);

export function yearOf(month: Month): number {
  return parts(month).year;
}

/** 1…12. */
export function monthNumber(month: Month): number {
  return parts(month).month;
}

/** January … December of `year`. */
export function monthsOfYear(year: number): Month[] {
  return Array.from({ length: 12 }, (_, i) => make(year, i + 1));
}

/** "2026-10" → "2026-10-01" (`cost_entries.period`). */
export function monthToPeriod(month: Month): string {
  return `${month}-01`;
}

/** "2026-10-01" (or any date in October 2026) → "2026-10". */
export function periodToMonth(period: string): Month {
  const month = period.slice(0, 7);
  if (!isMonth(month)) throw new RangeError(`Not a cost period: ${period}`);
  return month;
}

/** Today's date "YYYY-MM-DD" in Stockkart's time zone (COST_TIMEZONE). */
export function localDate(now: Date, timeZone = COST_TIMEZONE): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** This month in Stockkart's time zone. */
export function currentMonth(now: Date, timeZone = COST_TIMEZONE): Month {
  return periodToMonth(localDate(now, timeZone));
}

/** The day of the month (1…31) of a "YYYY-MM-DD" date. */
export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

const LONG = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const NAME = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" });

function utcDate(month: Month): Date {
  const { year, month: m } = parts(month);
  return new Date(Date.UTC(year, m - 1, 1));
}

/** "October 2026". */
export function monthLabel(month: Month): string {
  return LONG.format(utcDate(month));
}

/** "Oct". */
export function monthShortLabel(month: Month): string {
  return SHORT.format(utcDate(month));
}

/** "October". */
export function monthName(month: Month): string {
  return NAME.format(utcDate(month));
}

/**
 * COST-7 reminder rule: on or after the reminder day of a month, the PREVIOUS month is the
 * one to complete. Returns that month, or null before the reminder day.
 */
export function reminderMonth(today: string, reminderDay: number): Month | null {
  if (dayOfMonth(today) < reminderDay) return null;
  return previousMonth(periodToMonth(today));
}
