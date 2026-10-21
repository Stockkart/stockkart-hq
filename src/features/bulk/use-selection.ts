"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

import { shouldIgnoreShortcut } from "@/features/issue/keyboard";
import { matchesShortcut } from "@/features/shell/shortcuts";

/** Marks a selectable row (the issue id), for the `x` shortcut. */
export const selectRowProps = (id: string) => ({ "data-select-id": id }) as const;

interface SelectionState {
  ids: ReadonlySet<string>;
  /** The last row toggled without shift: the start of a shift-click range. */
  anchor: string | null;
}

export interface RowSelection {
  /** Selected ids among the visible ones, in visible order. */
  selectedIds: string[];
  isSelected: (id: string) => boolean;
  /** `range`: shift held, so every row from the anchor to `id` takes `id`'s new state. */
  toggle: (id: string, range?: boolean) => void;
  selectAll: () => void;
  clear: () => void;
  allSelected: boolean;
  someSelected: boolean;
}

/**
 * The pure state change of a toggle (exported for tests). Without an anchor (or when it is
 * no longer visible) a shift-click is a plain toggle.
 */
export function toggleSelection(
  state: SelectionState,
  visibleIds: readonly string[],
  id: string,
  range: boolean,
): SelectionState {
  const on = !state.ids.has(id);
  const next = new Set(state.ids);
  const from = state.anchor === null ? -1 : visibleIds.indexOf(state.anchor);
  const to = visibleIds.indexOf(id);
  if (range && from !== -1 && to !== -1) {
    const [start, end] = from < to ? [from, to] : [to, from];
    for (const rowId of visibleIds.slice(start, end + 1)) {
      if (on) next.add(rowId);
      else next.delete(rowId);
    }
    return { ids: next, anchor: state.anchor };
  }
  if (on) next.add(id);
  else next.delete(id);
  return { ids: next, anchor: id };
}

/**
 * ISS-12 row selection for the issue list and the backlog: checkboxes, shift-click ranges,
 * "select all visible", and `x` on the focused row. Only VISIBLE rows count: a row hidden by
 * a filter (or removed by an edit) drops out of the selection by itself, so a bulk edit
 * never touches something the user cannot see.
 */
export function useRowSelection(visibleIds: readonly string[]): RowSelection {
  const [state, setState] = useState<SelectionState>({ ids: new Set(), anchor: null });
  const selectedIds = visibleIds.filter((id) => state.ids.has(id));
  return {
    selectedIds,
    isSelected: (id) => state.ids.has(id) && visibleIds.includes(id),
    toggle: (id, range = false) =>
      setState((current) => toggleSelection(current, visibleIds, id, range)),
    selectAll: () => setState({ ids: new Set(visibleIds), anchor: null }),
    clear: () => setState({ ids: new Set(), anchor: null }),
    allSelected: visibleIds.length > 0 && selectedIds.length === visibleIds.length,
    someSelected: selectedIds.length > 0,
  };
}

/**
 * SPEC §9.5 `x`: toggles the selection of the row that has focus (J/K moves focus between
 * rows). Ignored while typing, with modifiers, and inside dialogs and menus.
 */
export function useSelectShortcut(
  container: RefObject<HTMLElement | null>,
  toggle: (id: string) => void,
) {
  // The latest toggle (it changes every render), without re-subscribing the listener.
  const latest = useRef(toggle);
  useEffect(() => {
    latest.current = toggle;
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!matchesShortcut(event, "select") || shouldIgnoreShortcut(event)) return;
      const root = container.current;
      const active = document.activeElement;
      if (!root || !active || !root.contains(active)) return;
      const row = active.closest<HTMLElement>("[data-select-id]");
      const id = row?.dataset.selectId;
      if (!id) return;
      event.preventDefault();
      latest.current(id);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [container]);
}
