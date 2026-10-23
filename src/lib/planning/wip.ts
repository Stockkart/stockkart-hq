/**
 * BRD-5 WIP limits on the board. A column counts the cards it shows, so the count follows
 * the board's scope (the active sprint, or every open issue). Isomorphic and pure.
 *
 * - at or under the limit: fine ("3 / 4");
 * - over it: the column turns amber with an "Over WIP limit" badge;
 * - moving a card into a column that is already full (count ≥ limit) is allowed, with a
 *   warning.
 */

export interface WipState {
  /** "3 / 4", or just "3" without a limit. */
  label: string;
  /** Spoken form: "3 issues, WIP limit 4". */
  description: string;
  over: boolean;
}

const issues = (count: number) => `${count} ${count === 1 ? "issue" : "issues"}`;

export function wipState(count: number, limit: number | null | undefined): WipState {
  if (limit === null || limit === undefined) {
    return { label: String(count), description: issues(count), over: false };
  }
  return {
    label: `${count} / ${limit}`,
    description: `${issues(count)}, WIP limit ${limit}`,
    over: count > limit,
  };
}

/** Whether one more card would put a column with `count` cards over its limit. */
export function isFull(count: number, limit: number | null | undefined): boolean {
  return limit !== null && limit !== undefined && count >= limit;
}
