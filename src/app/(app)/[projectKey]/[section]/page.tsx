import { Construction } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import { requirePageSession } from "@/server/auth/require-session";

/**
 * "Coming soon" placeholder for the project pages in the sidebar (§5.1) that later Phase 1
 * slices build. A real page at e.g. `[projectKey]/backlog/page.tsx` takes precedence over
 * this dynamic segment, so each slice simply adds its own route.
 */
const SECTIONS: Record<string, string> = {
  backlog: "Backlog",
  board: "Board",
  sprints: "Sprints",
  roadmap: "Roadmap",
  docs: "Docs",
  adrs: "ADRs",
  diagrams: "Diagrams",
  incidents: "Incidents",
  services: "Services",
};

interface Props {
  params: Promise<{ projectKey: string; section: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section } = await params;
  return { title: SECTIONS[section] ?? "Not found" };
}

export default async function ComingSoonPage({ params }: Props) {
  await requirePageSession();
  const { projectKey, section } = await params;
  const label = SECTIONS[section];
  if (!label || !PROJECT_KEY_PATTERN.test(projectKey)) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2">
      <h1 className="text-2xl font-semibold">{label}</h1>
      <section className="mt-6 flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
        <Construction aria-hidden="true" className="size-6 text-muted-foreground" />
        <h2 className="font-medium">Coming soon</h2>
        <p className="text-sm text-muted-foreground">
          {label} for {projectKey} is not built yet. Meanwhile, the{" "}
          <Link href={`/${projectKey}/issues`} className="underline underline-offset-2">
            issue list
          </Link>{" "}
          has everything.
        </p>
      </section>
    </div>
  );
}
