/**
 * Client-side reorder maths shared by the backlog and the todo list. A move is sent to the
 * server as "after this row" (`afterId`, null = the very top), see `moveIssueInput`.
 */

export const MOVE_KINDS = ["top", "up", "down", "bottom"] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];

export const MOVE_LABELS: Record<MoveKind, string> = {
  top: "Move to top",
  up: "Move up",
  down: "Move down",
  bottom: "Move to bottom",
};

export interface Reorder {
  /** The new order of `ids`. */
  order: string[];
  /** The row the moved one now follows, or null when it is first. */
  afterId: string | null;
}

/** Moves `id` to `toIndex` within `ids`; null when that changes nothing. */
export function moveToIndex(ids: readonly string[], id: string, toIndex: number): Reorder | null {
  const from = ids.indexOf(id);
  if (from === -1) return null;
  const to = Math.min(ids.length - 1, Math.max(0, toIndex));
  if (to === from) return null;
  const order = ids.filter((item) => item !== id);
  order.splice(to, 0, id);
  return { order, afterId: to === 0 ? null : (order[to - 1] ?? null) };
}

/** The keyboard alternative to dragging (SPEC §9.5 "Move to…" menu). */
export function moveBy(ids: readonly string[], id: string, kind: MoveKind): Reorder | null {
  const from = ids.indexOf(id);
  if (from === -1) return null;
  const to = { top: 0, up: from - 1, down: from + 1, bottom: ids.length - 1 }[kind];
  return moveToIndex(ids, id, to);
}

/** Drag and drop: `id` dropped onto the position of `overId` (dnd-kit sortable semantics). */
export function dropOnto(ids: readonly string[], id: string, overId: string): Reorder | null {
  const to = ids.indexOf(overId);
  return to === -1 ? null : moveToIndex(ids, id, to);
}

/** Which move-menu entries do something for the row at `index` of `count`. */
export function availableMoves(index: number, count: number): Record<MoveKind, boolean> {
  return {
    top: index > 0,
    up: index > 0,
    down: index < count - 1,
    bottom: index < count - 1,
  };
}

/**
 * The optimistic version of a server move on a FULL ordered list (which may hold rows of
 * other groups): `id` goes right after `afterId`, or first. Unknown ids change nothing.
 */
export function applyMove<T extends { id: string }>(
  list: readonly T[],
  id: string,
  afterId: string | null,
): T[] {
  const moved = list.find((item) => item.id === id);
  if (!moved || id === afterId) return [...list];
  const rest = list.filter((item) => item.id !== id);
  if (afterId === null) return [moved, ...rest];
  const at = rest.findIndex((item) => item.id === afterId);
  if (at === -1) return [...list];
  return [...rest.slice(0, at + 1), moved, ...rest.slice(at + 1)];
}
