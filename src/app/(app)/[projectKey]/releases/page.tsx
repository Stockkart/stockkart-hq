import type { Metadata } from "next";

import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { ReleasesOverview } from "@/features/releases/releases-overview";
import { requirePageSession } from "@/server/auth/require-session";
import { releaseQueries } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Releases · ${projectKey.toUpperCase()}` };
}

/** REL-1: unreleased releases first (by target date), then released ones, newest first. */
export default async function ReleasesPage({ params }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  await requirePageSession();
  const { projectKey } = await params;
  const key = resolveProjectKey(projectKey, "/releases");
  // One round trip: the query finds the project by key itself.
  const [project, releases] = await Promise.all([
    requireProject(key),
    releaseQueries.listReleases(projectIdByKey(key)),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <ReleasesOverview projectKey={project.key} releases={releases} />
    </div>
  );
}
