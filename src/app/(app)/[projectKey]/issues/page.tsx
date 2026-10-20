import type { Metadata } from "next";

import { IssueList } from "@/features/issue/issue-list";
import { loadProjectFromRoute } from "@/features/issue/project-route";
import { FilterBar } from "@/features/planning/filter-bar";
import {
  DEFAULT_SORT,
  filtersToSearchParams,
  parseIssueFilters,
  parseIssueSort,
} from "@/lib/issues/filters";
import { requirePageSession } from "@/server/auth/require-session";
import { issueQueries, planningQueries } from "@/server/services";

interface Props {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Issues · ${projectKey.toUpperCase()}` };
}

/** VW-1/VW-2: filters and sort come from the URL; invalid params are ignored. */
export default async function IssuesPage({ params, searchParams }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  const { projectKey } = await params;
  const raw = await searchParams;
  const filters = parseIssueFilters(raw);
  const sort = parseIssueSort(raw);
  // Only an explicit, valid sort goes back into URLs; the default stays implicit.
  const preserved = sort === DEFAULT_SORT ? {} : { sort: sort.by, dir: sort.dir };
  const query = filtersToSearchParams(filters, preserved).toString();
  const project = await loadProjectFromRoute(projectKey, `/issues${query ? `?${query}` : ""}`);
  const [issues, meta] = await Promise.all([
    planningQueries.listIssues(project.id, {
      scope: "all",
      filters,
      sort,
      currentUserId: session.user.id,
    }),
    issueQueries.getProjectMeta(project.id),
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
      <FilterBar filters={filters} options={meta} preserved={preserved} />
      <IssueList issues={issues} projectKey={project.key} filters={filters} sort={sort} />
    </div>
  );
}
