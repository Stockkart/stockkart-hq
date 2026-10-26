"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { LAST_VIEW_QUERY_MAX, lastViewKey, withStoredQuery } from "@/lib/views/last-view";

/**
 * VW-5 storage: the last view of the board and the backlog, per browser in `localStorage`.
 * A personal convenience, like the optional list columns: not in the URL contract, not
 * shared. The server render and the first client render use the plain link, so hydration
 * never mismatches; the remembered one applies right after.
 */

const EVENT = "hq:last-view";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage blocked (privacy mode): links open the defaults.
    return null;
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

/**
 * Remembers the current page's query. Rendered by the board and backlog pages; every URL
 * change (a filter, the sprint picker, "Clear filters") is stored, the plain URL as "".
 */
export function RememberView() {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  useEffect(() => {
    const key = lastViewKey(pathname);
    if (!key) return;
    try {
      if (query && query.length <= LAST_VIEW_QUERY_MAX) window.localStorage.setItem(key, query);
      else window.localStorage.removeItem(key);
    } catch {
      return;
    }
    window.dispatchEvent(new Event(EVENT));
  }, [pathname, query]);
  return null;
}

/** `href` with its remembered view, read now (for navigation outside a render). */
export function rememberedHref(href: string): string {
  const key = lastViewKey(href);
  return key ? withStoredQuery(href, read(key)) : href;
}

/** `href` with its remembered view, kept up to date (for links). */
export function useRememberedHref(href: string): string {
  const key = lastViewKey(href);
  const stored = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : null),
    () => null,
  );
  return withStoredQuery(href, stored);
}
