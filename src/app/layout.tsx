import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { themeClassName, themeColorEntries } from "@/lib/theme/theme";
import { getThemePreference } from "@/server/theme/preference";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Stockkart HQ", template: "%s · Stockkart HQ" },
  description: "Work, knowledge and diagrams for the Stockkart team.",
  // Private app: keep it out of search engines even though every page requires sign-in.
  robots: { index: false, follow: false },
};

/** `theme-color` for both schemes, following an explicit theme choice (README "Dark mode"). */
export async function generateViewport(): Promise<Viewport> {
  const preference = await getThemePreference();
  return { themeColor: themeColorEntries(preference) };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // The theme class is rendered on the server from the cookie, so the first paint is right
  // without an inline script (S-9: keeps the planned nonce CSP possible).
  const preference = await getThemePreference();
  return (
    <html lang="en" className={themeClassName(preference)}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
