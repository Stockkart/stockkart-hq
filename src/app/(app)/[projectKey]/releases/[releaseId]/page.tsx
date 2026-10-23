import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { ReleaseDetail } from "@/features/releases/release-detail";
import { requirePageSession } from "@/server/auth/require-session";
import { releaseQueries } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string; releaseId: string }>;
}

export function generateMetadata(): Metadata {
  return { title: "Release" };
}

/** REL-1/2: one release's progress, issues by status category and type, and its notes. */
export default async function ReleasePage({ params }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  await requirePageSession();
  const { projectKey, releaseId } = await params;
  if (!z.uuid().safeParse(releaseId).success) notFound();
  const key = resolveProjectKey(projectKey, `/releases/${releaseId}`);
  // One round trip: every query finds the project by key itself. The list doubles as this
  // release's summary and the move-open-issues targets.
  const projectId = projectIdByKey(key);
  const [project, releases, issues] = await Promise.all([
    requireProject(key),
    releaseQueries.listReleases(projectId),
    releaseQueries.listReleaseIssues(projectId, releaseId),
  ]);
  // A release deleted from this very page re-renders it without the release; the client
  // shows a message (an id outside the project's releases renders the same, revealing
  // nothing: every release is listed anyway).

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <ReleaseDetail
        projectKey={project.key}
        releaseId={releaseId}
        releases={releases}
        issues={issues}
      />
    </div>
  );
}
