import type { Metadata } from "next";

import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { SprintsOverview } from "@/features/sprints/sprints-overview";
import { computeBurndown, computeVelocity } from "@/lib/sprints/burndown";
import { isoDateOf, nextSprintDefaults } from "@/lib/sprints/dates";
import { requirePageSession } from "@/server/auth/require-session";
import { sprintQueries } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Sprints · ${projectKey.toUpperCase()}` };
}

/** SPR-1…4: sprints with the active burndown and the velocity of the last closed ones. */
export default async function SprintsPage({ params }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  await requirePageSession();
  const { projectKey } = await params;
  const key = resolveProjectKey(projectKey, "/sprints");
  // One round trip: every query finds the project (and the target sprints) by key itself.
  const projectId = projectIdByKey(key);
  const [project, sprints, inputs] = await Promise.all([
    requireProject(key),
    sprintQueries.listSprints(projectId),
    sprintQueries.burndownInputs(projectId, sprintQueries.activeAndRecentClosed(projectId)),
  ]);
  const now = new Date();
  const activeTimeline = inputs.timelines.find((timeline) => timeline.closedAt === null);
  const activeBurndown = activeTimeline ? computeBurndown(activeTimeline, inputs.data, now) : null;
  const velocity = computeVelocity(inputs.timelines, inputs.data);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <SprintsOverview
        projectKey={project.key}
        sprintLengthDays={project.sprintLengthDays}
        sprints={sprints}
        defaults={nextSprintDefaults(sprints, project.sprintLengthDays, isoDateOf(now))}
        activeBurndown={activeBurndown}
        velocity={velocity}
      />
    </div>
  );
}
