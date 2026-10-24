/**
 * Colour theme (README "Dark mode"), isomorphic.
 *
 * The preference lives in the `hq_theme` cookie only (no user record): `light`, `dark` or
 * `system` (the default). The root layout reads it on the server and renders the matching
 * class on `<html>`, so the first paint is already right without an inline script (the
 * future nonce CSP stays possible, S-9). The client toggle changes the class and rewrites
 * the cookie, so a switch applies at once and survives a reload.
 */

export const THEME_COOKIE = "hq_theme";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/** One year. Not HttpOnly: the client toggle writes it, and it is not sensitive. */
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** The `<html>` classes the theme owns (globals.css `@custom-variant dark`). */
export const DARK_CLASS = "dark";
export const SYSTEM_CLASS = "theme-system";

export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";
export const LIGHT_MEDIA_QUERY = "(prefers-color-scheme: light)";

/** `--background` of each theme (oklch(1 0 0) and oklch(0.145 0 0)) for `theme-color`. */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#0a0a0a",
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** The cookie's value as a preference; anything missing or unknown means `system`. */
export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
}

/** The class for `<html>`: `dark`, `theme-system`, or none for `light`. */
export function themeClassName(preference: ThemePreference): string | undefined {
  if (preference === "dark") return DARK_CLASS;
  if (preference === "system") return SYSTEM_CLASS;
  return undefined;
}

/** The `document.cookie` assignment that stores a preference (path=/, SameSite=Lax, 1 year). */
export function themeCookie(preference: ThemePreference, { secure }: { secure: boolean }): string {
  return [
    `${THEME_COOKIE}=${preference}`,
    "Path=/",
    `Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/**
 * `<meta name="theme-color">` for both schemes. There are always two tags (one per media
 * query) so the client can retarget them in place: an explicit choice gives both its colour.
 */
export function themeColorEntries(preference: ThemePreference): { media: string; color: string }[] {
  const forScheme = (scheme: ResolvedTheme) =>
    preference === "system" ? THEME_COLORS[scheme] : THEME_COLORS[preference];
  return [
    { media: LIGHT_MEDIA_QUERY, color: forScheme("light") },
    { media: DARK_MEDIA_QUERY, color: forScheme("dark") },
  ];
}
