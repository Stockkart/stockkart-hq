import type { Metadata } from "next";

import { loadProjectFromRoute } from "@/features/issue/project-route";
import { Board } from "@/features/planning/board";
import { EMPTY_FILTERS } from "@/lib/issues/filters";
import { requirePageSession } from "@/server/auth/require-session";
import { issueQueries, planningQueries } from "@/server/services";
import { BOARD_DONE_DAYS } from "@/server/services/planning-queries";

interface Props {
  params: Promise<{ projectKey: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Board · ${projectKey.toUpperCase()}` };
}

/** SPEC §5.3 / BRD-1, 2, 3. Swimlanes (BRD-4) and sprint scope arrive with sprints (P1). */
export default async function BoardPage({ params }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  const { projectKey } = await params;
  const project = await loadProjectFromRoute(projectKey, "/board");
  const [issues, meta] = await Promise.all([
    planningQueries.listIssues(project.id, {
      scope: "board",
      filters: EMPTY_FILTERS,
      currentUserId: session.user.id,
    }),
    issueQueries.getProjectMeta(project.id),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Board</h1>
        <p className="text-sm text-muted-foreground">
          All open issues, plus issues done in the last {BOARD_DONE_DAYS} days. Sprint boards arrive
          with sprints.
        </p>
      </div>
      <Board issues={issues} statuses={meta.statuses} projectKey={project.key} />
    </div>
  );
}
