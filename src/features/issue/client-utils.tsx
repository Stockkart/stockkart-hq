"use client";

import { toast } from "sonner";

import { type ActionResult } from "@/lib/action-result";

/**
 * Runs a server action and reports failures as a toast. Returns the data, or null on failure
 * (callers roll back optimistic state). A thrown error (e.g. the session ended) gets a
 * generic message; details stay in the server logs.
 */
export async function callAction<T>(action: () => Promise<ActionResult<T>>): Promise<T | null> {
  try {
    const result = await action();
    if (result.ok) return result.data;
    toast.error(result.error);
  } catch {
    toast.error("Something went wrong. Reload the page and try again.");
  }
  return null;
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const ABSOLUTE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export function relativeTime(date: Date, now = Date.now()): string {
  const seconds = Math.round((date.getTime() - now) / 1000);
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/** "2 days ago", with the exact time as a tooltip. Server and browser clocks may differ. */
export function RelativeTime({ date }: { date: Date }) {
  return (
    <time dateTime={date.toISOString()} title={ABSOLUTE.format(date)} suppressHydrationWarning>
      {relativeTime(date)}
    </time>
  );
}
