import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePageSession } from "@/server/auth/require-session";

/**
 * Unknown project sections. Every sidebar section (§5.1) has a real route now (a real page
 * at e.g. `[projectKey]/roadmap/page.tsx` takes precedence over this dynamic segment), so
 * the former "coming soon" placeholder only answers what is left: `/<KEY>/<anything else>`.
 * It is kept, not deleted, because those URLs still reach it; it checks the session first
 * (so a signed-out visitor goes to sign-in, as on every app page) and then renders the 404
 * inside the app shell instead of Next's bare root 404.
 */
export const metadata: Metadata = { title: "Not found" };

export default async function UnknownSectionPage() {
  await requirePageSession();
  notFound();
}
