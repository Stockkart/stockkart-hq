"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Optional issue-list columns (REL-1 "Fix version"), remembered per browser in
 * `localStorage`. A personal display preference, so it is neither in the URL nor in saved
 * views. The server render and the first client render show the default (hidden), so
 * hydration never mismatches; the stored choice applies right after.
 */

export const OPTIONAL_COLUMNS = ["release"] as const;
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];

const STORAGE_KEY = "hq.issue-list.columns";
const EVENT = "hq:issue-list-columns";

function read(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    // Storage blocked (privacy mode): the defaults apply.
    return "";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Parses the stored list, keeping only known columns. */
export function parseColumns(value: string): OptionalColumn[] {
  return OPTIONAL_COLUMNS.filter((column) => value.split(",").includes(column));
}

export function useOptionalColumns(): {
  shown: OptionalColumn[];
  toggle: (column: OptionalColumn, on: boolean) => void;
} {
  const stored = useSyncExternalStore(subscribe, read, () => "");
  const shown = parseColumns(stored);
  const toggle = useCallback((column: OptionalColumn, on: boolean) => {
    const current = parseColumns(read()).filter((item) => item !== column);
    const next = on ? [...current, column] : current;
    try {
      window.localStorage.setItem(STORAGE_KEY, next.join(","));
    } catch {
      // Not stored; nothing else to do.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return { shown, toggle };
}
