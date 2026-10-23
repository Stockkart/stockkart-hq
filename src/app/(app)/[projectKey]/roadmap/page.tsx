import type { Metadata } from "next";

import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { Roadmap } from "@/features/roadmap/roadmap";
import { parseRoadmapParams, roadmapSearchParams } from "@/lib/roadmap/filters";
import { isoDateOf } from "@/lib/sprints/dates";
import { requirePageSession } from "@/server/auth/require-session";
import { issueQueries, roadmapQueries } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Roadmap · ${projectKey.toUpperCase()}` };
}

/** RDM-1/RDM-2: the epics on a timeline, with progress and dependencies. One round trip. */
export default async function RoadmapPage({ params, searchParams }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  const { projectKey } = await params;
  const view = parseRoadmapParams(await searchParams);
  const query = roadmapSearchParams(view).toString();
  const key = resolveProjectKey(projectKey, `/roadmap${query ? `?${query}` : ""}`);
  // Every query finds the project by key itself, so they all go in one batch.
  const projectId = projectIdByKey(key);
  const [project, epics, dependencies, meta] = await Promise.all([
    requireProject(key),
    roadmapQueries.listEpics(projectId, view.filters, session.user.id),
    roadmapQueries.listDependencies(projectId),
    issueQueries.getProjectMeta(projectId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Roadmap</h1>
        <p className="text-sm text-muted-foreground">
          Epics from start to due date; progress is the share of child points done.
        </p>
      </div>
      <Roadmap
        projectKey={project.key}
        epics={epics}
        dependencies={dependencies}
        zoom={view.zoom}
        filters={view.filters}
        components={meta.components}
        users={meta.users}
        // The UTC date, like the sprint pages' "today" (off by a day near midnight elsewhere).
        today={isoDateOf(new Date())}
      />
    </div>
  );
}
