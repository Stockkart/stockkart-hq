import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Stockkart HQ", template: "%s · Stockkart HQ" },
  description: "Work, knowledge and diagrams for the Stockkart team.",
  // Private app: keep it out of search engines even though every page requires sign-in.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
