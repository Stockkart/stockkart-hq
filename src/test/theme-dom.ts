import { vi } from "vitest";

/**
 * jsdom has no `matchMedia`; this stand-in reports `prefers-color-scheme: dark` as `dark`
 * says and lets a test flip it (firing `change`, like a browser when the OS theme changes).
 */
export function stubColorScheme(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query === "(prefers-color-scheme: dark)" ? dark : false;
    },
    media: query,
    addEventListener: (_type: "change", listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: "change", listener: () => void) => listeners.delete(listener),
  }));
  return {
    setDark(next: boolean) {
      dark = next;
      for (const listener of listeners) listener();
    },
  };
}

/** Resets `<html>` to a theme class (as the root layout would render it) and the cookie. */
export function resetThemeDom(className: "" | "dark" | "theme-system" = "") {
  document.documentElement.className = className;
  document.cookie = "hq_theme=; Path=/; Max-Age=0";
}
