import type { Metadata } from "next";

import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { Board } from "@/features/planning/board";
import { BoardScopeSwitch } from "@/features/planning/board-scope";
import { LimitNotice } from "@/features/planning/limit-notice";
import { EMPTY_FILTERS } from "@/lib/issues/filters";
import { parseBoardScope } from "@/lib/sprints/schemas";
import { requirePageSession } from "@/server/auth/require-session";
import { issueQueries, planningQueries, sprintQueries } from "@/server/services";
import { BOARD_DONE_DAYS, ISSUE_LIST_LIMIT } from "@/server/services/planning-queries";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Board · ${projectKey.toUpperCase()}` };
}

/**
 * SPEC §5.3 / BRD-1, 2, 3. BRD-3 scope: the active sprint's issues by default when a sprint
 * is active, or every open issue with `?scope=all`. Without an active sprint the board shows
 * every open issue either way. Swimlanes (BRD-4) come later.
 */
export default async function BoardPage({ params, searchParams }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  const { projectKey } = await params;
  const scope = parseBoardScope(await searchParams);
  const key = resolveProjectKey(projectKey, scope === "all" ? "/board?scope=all" : "/board");
  // One round trip: the queries find the project (and the active sprint) by key themselves;
  // "active sprint or all open" is decided inside the issue query.
  const projectId = projectIdByKey(key);
  const [project, issues, meta, activeSprint] = await Promise.all([
    requireProject(key),
    planningQueries.listIssues(projectId, {
      scope: scope === "all" ? "board" : "board_sprint",
      filters: EMPTY_FILTERS,
      currentUserId: session.user.id,
    }),
    issueQueries.getProjectMeta(projectId),
    sprintQueries.getActiveSprint(projectId),
  ]);
  const sprintScope = scope === "sprint" && activeSprint !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-4">
          <h1 className="text-2xl font-semibold">Board</h1>
          {activeSprint ? (
            <BoardScopeSwitch
              projectKey={project.key}
              scope={scope}
              sprintName={activeSprint.name}
            />
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {sprintScope
            ? `Every issue in ${activeSprint.name}.`
            : `All open issues, plus issues done in the last ${BOARD_DONE_DAYS} days.`}
        </p>
      </div>
      <LimitNotice count={issues.length} limit={ISSUE_LIST_LIMIT} />
      <Board issues={issues} statuses={meta.statuses} projectKey={project.key} />
    </div>
  );
}
