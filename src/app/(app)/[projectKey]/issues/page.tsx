import type { Metadata } from "next";
import { z } from "zod";

import { IssueList } from "@/features/issue/issue-list";
import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { FilterBar } from "@/features/planning/filter-bar";
import { LimitNotice } from "@/features/planning/limit-notice";
import { ViewControls } from "@/features/views/view-controls";
import {
  DEFAULT_SORT,
  filtersToSearchParams,
  parseIssueFilters,
  parseIssueSort,
} from "@/lib/issues/filters";
import { VIEW_PARAM, viewFilterOf } from "@/lib/views/saved-views";
import { requirePageSession } from "@/server/auth/require-session";
import { issueQueries, planningQueries, savedViewService } from "@/server/services";
import { ISSUE_LIST_LIMIT } from "@/server/services/planning-queries";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Issues · ${projectKey.toUpperCase()}` };
}

/**
 * VW-1/VW-2: filters and sort come from the URL; invalid params are ignored. VW-3: a saved
 * view is a link to this page with its filters, plus `view=<id>` (kept while filtering, so
 * "Update view" can store the changed filters).
 */
export default async function IssuesPage({ params, searchParams }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  const { projectKey } = await params;
  const raw = await searchParams;
  const filters = parseIssueFilters(raw);
  const sort = parseIssueSort(raw);
  // Only an explicit, valid sort goes back into URLs; the default stays implicit.
  const sortParams = sort === DEFAULT_SORT ? {} : { sort: sort.by, dir: sort.dir };
  const rawView = raw[VIEW_PARAM];
  const viewId = z.uuid().safeParse(Array.isArray(rawView) ? rawView[0] : rawView);
  const preserved = { ...sortParams, view: viewId.success ? viewId.data : undefined };
  const query = filtersToSearchParams(filters, preserved).toString();
  const key = resolveProjectKey(projectKey, `/issues${query ? `?${query}` : ""}`);
  // One round trip: the queries find the project by key themselves.
  const projectId = projectIdByKey(key);
  const [project, issues, meta, activeView] = await Promise.all([
    requireProject(key),
    planningQueries.listIssues(projectId, {
      scope: "all",
      filters,
      sort,
      currentUserId: session.user.id,
    }),
    issueQueries.getProjectMeta(projectId),
    // Readable only when it is the user's own or shared (null otherwise).
    viewId.success ? savedViewService.getView(session.user.id, viewId.data) : null,
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Issues</h1>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {issues.length} {issues.length === 1 ? "issue" : "issues"} · press{" "}
          <kbd className="rounded border px-1 font-mono text-xs">C</kbd> to create
        </p>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <FilterBar filters={filters} options={meta} preserved={preserved} />
        <ViewControls
          projectKey={project.key}
          activeView={activeView}
          currentFilter={viewFilterOf(raw)}
        />
      </div>
      <LimitNotice count={issues.length} limit={ISSUE_LIST_LIMIT} />
      <IssueList
        issues={issues}
        projectKey={project.key}
        filters={filters}
        sort={sort}
        bulkOptions={meta}
        viewId={preserved.view}
      />
    </div>
  );
}
