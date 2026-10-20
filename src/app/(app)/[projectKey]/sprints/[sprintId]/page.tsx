import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { SprintDetail } from "@/features/sprints/sprint-detail";
import { EMPTY_FILTERS } from "@/lib/issues/filters";
import { computeBurndown } from "@/lib/sprints/burndown";
import { requirePageSession } from "@/server/auth/require-session";
import { planningQueries, sprintQueries } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string; sprintId: string }>;
}

export function generateMetadata(): Metadata {
  return { title: "Sprint" };
}

/** SPR-3: one sprint, its burndown (active or closed) and its issues. */
export default async function SprintPage({ params }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  const { projectKey, sprintId } = await params;
  if (!z.uuid().safeParse(sprintId).success) notFound();
  const key = resolveProjectKey(projectKey, `/sprints/${sprintId}`);
  // One round trip: every query finds the project and the sprint by key and id itself.
  const projectId = projectIdByKey(key);
  const [project, sprints, inputs, issues] = await Promise.all([
    requireProject(key),
    sprintQueries.listSprints(projectId),
    sprintQueries.burndownInputs(projectId, sprintQueries.oneSprint(projectId, sprintId)),
    planningQueries.listIssues(projectId, {
      scope: "all",
      filters: EMPTY_FILTERS,
      currentUserId: session.user.id,
      sprintId,
    }),
  ]);
  // A sprint deleted from this very page re-renders it without the sprint: the client
  // shows "This sprint was deleted" rather than a 404. Any id outside the project's
  // sprints renders the same message (it reveals nothing; every sprint is listed anyway).
  const [timeline] = inputs.timelines;
  const burndown = timeline ? computeBurndown(timeline, inputs.data, new Date()) : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <SprintDetail
        projectKey={project.key}
        sprintLengthDays={project.sprintLengthDays}
        sprintId={sprintId}
        sprints={sprints}
        burndown={burndown}
        issues={issues}
      />
    </div>
  );
}
