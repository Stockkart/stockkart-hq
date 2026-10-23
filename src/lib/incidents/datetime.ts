/**
 * `<input type="datetime-local">` ⇄ instants, in the browser's time zone. Isomorphic and
 * pure; the server only ever receives ISO strings with an offset.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** A Date as the input's value (`YYYY-MM-DDTHH:mm`, local time). */
export function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** The input's value as an ISO instant, or null when empty or malformed. */
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const DATE_TIME = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/** "Oct 20, 2026, 10:05 AM" in the viewer's time zone. */
export function formatDateTime(date: Date): string {
  return DATE_TIME.format(date);
}
