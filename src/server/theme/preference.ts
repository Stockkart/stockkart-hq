import { cookies } from "next/headers";

import { parseThemePreference, THEME_COOKIE, type ThemePreference } from "@/lib/theme/theme";

/**
 * The theme preference from the `hq_theme` cookie (default `system`). Not a security
 * setting, so it is read for every page, the login page included.
 */
export async function getThemePreference(): Promise<ThemePreference> {
  const store = await cookies();
  return parseThemePreference(store.get(THEME_COOKIE)?.value);
}
