"use client";

import { type RefObject, useEffect } from "react";

import { shouldIgnoreShortcut } from "@/features/issue/keyboard";

/** Marks a row (`data-nav-item`) and the link inside it that J/K focuses (`data-nav-link`). */
export const NAV_ITEM = { "data-nav-item": "" } as const;
export const NAV_LINK = { "data-nav-link": "" } as const;

/**
 * SPEC §9.5 `J`/`K`: move the selection down/up a list; `Enter` opens it. The selection IS
 * keyboard focus on the row's main link, so Enter opens it natively, screen readers
 * announce it and Tab continues from there. Rows are found in the DOM on each key press,
 * so filtering, grouping and collapsing need no bookkeeping. Ignored while typing, with
 * modifiers, or inside dialogs and menus (`shouldIgnoreShortcut`).
 */
export function useListNavigation(container: RefObject<HTMLElement | null>) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if ((key !== "j" && key !== "k") || shouldIgnoreShortcut(event)) return;
      const root = container.current;
      if (!root) return;
      // Rows inside collapsed sections are skipped.
      const links = [
        ...root.querySelectorAll<HTMLElement>("[data-nav-item] [data-nav-link]"),
      ].filter((link) => !link.closest("[hidden]"));
      if (links.length === 0) return;
      event.preventDefault();
      const active = document.activeElement;
      const current = links.findIndex(
        (link) => link === active || link.closest("[data-nav-item]")?.contains(active),
      );
      // From nothing selected, J starts at the top and K at the bottom.
      const next =
        current === -1
          ? key === "j"
            ? 0
            : links.length - 1
          : Math.min(links.length - 1, Math.max(0, current + (key === "j" ? 1 : -1)));
      const target = links[next];
      if (!target) return;
      target.focus();
      // Not every environment implements it (jsdom in tests).
      if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "nearest" });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [container]);
}
