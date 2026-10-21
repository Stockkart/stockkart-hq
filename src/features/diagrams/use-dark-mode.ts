"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the app is in dark mode: the `dark` class on `<html>` (Tailwind's `dark:` variant,
 * globals.css). The canvases follow it live (DGM-1/2 "theme follows the app").
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const isDark = () => document.documentElement.classList.contains("dark");

export function useDarkMode(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => false);
}
