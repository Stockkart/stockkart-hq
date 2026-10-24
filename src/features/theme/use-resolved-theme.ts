"use client";

import { useSyncExternalStore } from "react";

import { type ResolvedTheme, type ThemePreference } from "@/lib/theme/theme";

import { readResolvedTheme, readThemePreference, subscribeToTheme } from "./theme-dom";

/**
 * The theme on screen (`light` | `dark`) for JS consumers that cannot use CSS: Excalidraw's
 * `theme`, React Flow's `colorMode`, Mermaid's theme and sonner's `theme`. It follows the
 * `<html>` class (the toggle) and, in `system` mode, `prefers-color-scheme`, live
 * (DGM-1/2 "theme follows the app"). The server snapshot is `light`; these consumers are
 * client-only, so they re-render with the real value straight after hydration.
 */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeToTheme, readResolvedTheme, () => "light");
}

/** The stored choice (`system` | `light` | `dark`); `initial` is the server's (cookie). */
export function useThemePreference(initial: ThemePreference): ThemePreference {
  return useSyncExternalStore(subscribeToTheme, readThemePreference, () => initial);
}
