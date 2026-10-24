import type { Metadata } from "next";

import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { Board } from "@/features/planning/board";
import { BoardScopeSwitch } from "@/features/planning/board-scope";
import { LimitNotice } from "@/features/planning/limit-notice";
import { EMPTY_FILTERS } from "@/lib/issues/filters";
import { parseBoardScope } from "@/lib/sprints/schemas";
import {
  BOARD_HIDE_PARAM,
  BOARD_TYPES_PARAM,
  boardViewQuery,
  parseBoardViewParams,
  resolveBoardView,
  resolveDefaults,
} from "@/lib/views/view-defaults";
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
 * SPEC §5.3 / BRD-1, 2, 3, 6. BRD-3 scope: the active sprint's issues by default when a
 * sprint is active, or every open issue with `?scope=all`. Without an active sprint the
 * board shows every open issue either way. BRD-6: `?types=` and `?hide=` pick the issue
 * types and hidden columns; without them the project's board defaults apply (they come
 * with the project query, so still one round trip). Swimlanes (BRD-4) come later.
 */
export default async function BoardPage({ params, searchParams }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  const { projectKey } = await params;
  const raw = await searchParams;
  const scope = parseBoardScope(raw);
  const viewParams = parseBoardViewParams(raw);
  // Keeps the scope and the view params (as given) through the upper-case redirect.
  const keep = new URLSearchParams(scope === "all" ? [["scope", "all"]] : []);
  for (const name of [BOARD_TYPES_PARAM, BOARD_HIDE_PARAM]) {
    const value = raw[name];
    if (value !== undefined) keep.set(name, Array.isArray(value) ? value.join(",") : value);
  }
  const rest = keep.size > 0 ? `/board?${keep.toString()}` : "/board";
  const key = resolveProjectKey(projectKey, rest);
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
  const statusIds = meta.statuses.map((status) => status.id);
  const defaults = resolveDefaults(project.viewDefaults.board, statusIds);
  const view = resolveBoardView(viewParams, project.viewDefaults.board, statusIds);

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
              viewQuery={boardViewQuery(view, defaults)}
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
      <Board
        issues={issues}
        statuses={meta.statuses}
        projectKey={project.key}
        scope={scope}
        view={view}
        defaults={defaults}
      />
    </div>
  );
}
