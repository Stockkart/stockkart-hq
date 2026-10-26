import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { Board } from "@/features/planning/board";
import { BoardSprintPicker } from "@/features/planning/board-scope";
import { LimitNotice } from "@/features/planning/limit-notice";
import { RememberView } from "@/features/views/last-view";
import { EMPTY_FILTERS } from "@/lib/issues/filters";
import { boardHref, DEFAULT_BOARD_SELECTION, parseBoardSelection } from "@/lib/sprints/schemas";
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
 * SPEC §5.3 / BRD-1, 2, 3, 6. BRD-3: the active sprint's issues by default when a sprint
 * is active, any open sprint with `?sprint=<id>`, or every open issue with `?scope=all`
 * (also the default without an active sprint). A sprint that is not open in this project
 * (closed, deleted, or a stale remembered link) redirects to the default board. BRD-6:
 * `?types=` and `?hide=` pick the issue types and hidden columns; without them the
 * project's board defaults apply (they come with the project query, so still one round
 * trip). VW-5: the page remembers its query, so the sidebar's Board link reopens it.
 * Swimlanes (BRD-4) come later.
 */
export default async function BoardPage({ params, searchParams }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  const { projectKey } = await params;
  const raw = await searchParams;
  const selection = parseBoardSelection(raw);
  const viewParams = parseBoardViewParams(raw);
  // The view params as given, kept through the redirects below.
  const rawView = new URLSearchParams();
  for (const name of [BOARD_TYPES_PARAM, BOARD_HIDE_PARAM]) {
    const value = raw[name];
    if (value !== undefined) rawView.set(name, Array.isArray(value) ? value.join(",") : value);
  }
  // Keeps the selection and the view params through the upper-case redirect ("/board?…").
  const rest = boardHref("", selection, rawView).slice(1);
  const key = resolveProjectKey(projectKey, rest);
  // One round trip: the queries find the project (and the active sprint) by key themselves;
  // "active sprint or all open" is decided inside the issue query. `sprintId` is a parsed
  // uuid; the query also scopes it to this project.
  const projectId = projectIdByKey(key);
  const [project, issues, meta, activeSprint] = await Promise.all([
    requireProject(key),
    planningQueries.listIssues(projectId, {
      scope: selection.sprintId ? "all" : selection.scope === "all" ? "board" : "board_sprint",
      sprintId: selection.sprintId ?? undefined,
      filters: EMPTY_FILTERS,
      currentUserId: session.user.id,
    }),
    issueQueries.getProjectMeta(projectId),
    sprintQueries.getActiveSprint(projectId),
  ]);
  const pickedSprint = selection.sprintId
    ? meta.sprints.find((sprint) => sprint.id === selection.sprintId)
    : undefined;
  if (selection.sprintId && !pickedSprint) {
    redirect(boardHref(project.key, DEFAULT_BOARD_SELECTION, rawView));
  }
  const shownSprint = pickedSprint ?? (selection.scope === "sprint" ? activeSprint : null);
  const statusIds = meta.statuses.map((status) => status.id);
  const defaults = resolveDefaults(project.viewDefaults.board, statusIds);
  const view = resolveBoardView(viewParams, project.viewDefaults.board, statusIds);

  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={null}>
        <RememberView />
      </Suspense>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-4">
          <h1 className="text-2xl font-semibold">Board</h1>
          {meta.sprints.length > 0 ? (
            <BoardSprintPicker
              projectKey={project.key}
              selection={selection}
              sprints={meta.sprints}
              viewQuery={boardViewQuery(view, defaults)}
            />
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {shownSprint
            ? `Every issue in ${shownSprint.name}.`
            : `All open issues, plus issues done in the last ${BOARD_DONE_DAYS} days.`}
        </p>
      </div>
      <LimitNotice count={issues.length} limit={ISSUE_LIST_LIMIT} />
      <Board
        issues={issues}
        statuses={meta.statuses}
        projectKey={project.key}
        selection={selection}
        view={view}
        defaults={defaults}
      />
    </div>
  );
}
