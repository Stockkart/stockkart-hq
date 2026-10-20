import type { Metadata } from "next";

import { loadProjectFromRoute } from "@/features/issue/project-route";
import { Backlog } from "@/features/planning/backlog";
import { FilterBar } from "@/features/planning/filter-bar";
import { GroupPicker } from "@/features/planning/group-picker";
import {
  filtersToSearchParams,
  hasActiveFilters,
  parseBacklogGroup,
  parseIssueFilters,
} from "@/lib/issues/filters";
import { sumPoints } from "@/lib/planning/groups";
import { requirePageSession } from "@/server/auth/require-session";
import { issueQueries, planningQueries } from "@/server/services";

interface Props {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Backlog · ${projectKey.toUpperCase()}` };
}

/** SPEC §5.2 / BLG-1, 2, 4, 5. Sprint sections (BLG-3) arrive with sprints (P1). */
export default async function BacklogPage({ params, searchParams }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  const { projectKey } = await params;
  const raw = await searchParams;
  const filters = parseIssueFilters(raw);
  const group = parseBacklogGroup(raw);
  const preserved = { group: group === "none" ? undefined : group };
  const query = filtersToSearchParams(filters, preserved).toString();
  const project = await loadProjectFromRoute(projectKey, `/backlog${query ? `?${query}` : ""}`);
  const [issues, meta] = await Promise.all([
    planningQueries.listIssues(project.id, {
      scope: "backlog",
      filters,
      currentUserId: session.user.id,
    }),
    issueQueries.getProjectMeta(project.id),
  ]);
  const openStatuses = meta.statuses.filter((status) => status.category !== "done");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Backlog</h1>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {issues.length} {issues.length === 1 ? "issue" : "issues"} · {sumPoints(issues)} pts ·
          drag <span aria-hidden="true">⋮⋮</span> or use the row menu to reorder
        </p>
      </div>
      <FilterBar
        filters={filters}
        options={{ ...meta, statuses: openStatuses }}
        preserved={preserved}
      >
        <GroupPicker group={group} filters={filters} />
      </FilterBar>
      <Backlog
        issues={issues}
        projectKey={project.key}
        group={group}
        users={meta.users}
        filtered={hasActiveFilters(filters)}
      />
    </div>
  );
}
