import {
  DARK_CLASS,
  DARK_MEDIA_QUERY,
  SYSTEM_CLASS,
  themeClassName,
  themeColorEntries,
  themeCookie,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme/theme";

/**
 * Browser side of the theme (README "Dark mode"). The `<html>` class is the single source of
 * truth on the client: the server renders it from the cookie, the toggle changes it, and
 * every JS consumer (canvases, Mermaid, toasts) reads it through `useResolvedTheme`.
 */

function prefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_MEDIA_QUERY).matches;
}

/** The preference the `<html>` class encodes. */
export function readThemePreference(root: HTMLElement = document.documentElement): ThemePreference {
  if (root.classList.contains(DARK_CLASS)) return "dark";
  if (root.classList.contains(SYSTEM_CLASS)) return "system";
  return "light";
}

/** The theme actually shown: `system` follows `prefers-color-scheme`. */
export function readResolvedTheme(root: HTMLElement = document.documentElement): ResolvedTheme {
  const preference = readThemePreference(root);
  if (preference === "system") return prefersDark() ? "dark" : "light";
  return preference;
}

/** Calls `onChange` when the `<html>` class or the OS colour scheme changes. */
export function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const media =
    typeof window.matchMedia === "function" ? window.matchMedia(DARK_MEDIA_QUERY) : null;
  media?.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media?.removeEventListener("change", onChange);
  };
}

/**
 * Applies a preference at once, without a reload: swaps the `<html>` class, retargets the
 * `theme-color` tags and stores the cookie for the next server render.
 */
export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  root.classList.remove(DARK_CLASS, SYSTEM_CLASS);
  const className = themeClassName(preference);
  if (className) root.classList.add(className);

  for (const { media, color } of themeColorEntries(preference)) {
    // `media` is one of our two constants, never user input.
    const meta = document.head.querySelector<HTMLMetaElement>(
      `meta[name="theme-color"][media="${media}"]`,
    );
    if (meta) meta.content = color;
  }

  document.cookie = themeCookie(preference, { secure: window.location.protocol === "https:" });
}
