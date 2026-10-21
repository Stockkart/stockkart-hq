import type { Metadata } from "next";

import { requireProject, resolveProjectKey } from "@/features/issue/project-route";
import { Backlog } from "@/features/planning/backlog";
import { FilterBar } from "@/features/planning/filter-bar";
import { GroupPicker } from "@/features/planning/group-picker";
import { LimitNotice } from "@/features/planning/limit-notice";
import {
  filtersToSearchParams,
  hasActiveFilters,
  parseBacklogGroup,
  parseIssueFilters,
} from "@/lib/issues/filters";
import { sumPoints } from "@/lib/planning/groups";
import { isoDateOf, nextSprintDefaults } from "@/lib/sprints/dates";
import { requirePageSession } from "@/server/auth/require-session";
import { issueQueries, planningQueries, sprintQueries } from "@/server/services";
import { ISSUE_LIST_LIMIT } from "@/server/services/planning-queries";
import { projectIdByKey } from "@/server/services/sql";

interface Props {
  params: Promise<{ projectKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectKey } = await params;
  return { title: `Backlog · ${projectKey.toUpperCase()}` };
}

/** SPEC §5.2 / BLG-1…5, with the BLG-3 sprint sections above the backlog. */
export default async function BacklogPage({ params, searchParams }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  const { projectKey } = await params;
  const raw = await searchParams;
  const filters = parseIssueFilters(raw);
  const group = parseBacklogGroup(raw);
  const preserved = { group: group === "none" ? undefined : group };
  const query = filtersToSearchParams(filters, preserved).toString();
  const key = resolveProjectKey(projectKey, `/backlog${query ? `?${query}` : ""}`);
  // One round trip: the queries find the project by key themselves.
  const projectId = projectIdByKey(key);
  const [project, issues, meta, sprints] = await Promise.all([
    requireProject(key),
    planningQueries.listIssues(projectId, {
      scope: "planning",
      filters,
      currentUserId: session.user.id,
    }),
    issueQueries.getProjectMeta(projectId),
    sprintQueries.listSprints(projectId),
  ]);
  const openStatuses = meta.statuses.filter((status) => status.category !== "done");
  const openSprintIds = new Set(meta.sprints.map((sprint) => sprint.id));
  const backlogIssues = issues.filter(
    (issue) =>
      issue.status.category !== "done" &&
      (issue.sprintId === null || !openSprintIds.has(issue.sprintId)),
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Backlog</h1>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {backlogIssues.length} {backlogIssues.length === 1 ? "issue" : "issues"} ·{" "}
          {sumPoints(backlogIssues)} pts in the backlog · drag <span aria-hidden="true">⋮⋮</span> or
          use the row menu to reorder or move to a sprint
        </p>
      </div>
      <FilterBar
        filters={filters}
        options={{ ...meta, statuses: openStatuses }}
        preserved={preserved}
      >
        <GroupPicker group={group} filters={filters} />
      </FilterBar>
      <LimitNotice count={issues.length} limit={ISSUE_LIST_LIMIT} />
      <Backlog
        issues={issues}
        sprints={sprints}
        projectKey={project.key}
        sprintLengthDays={project.sprintLengthDays}
        sprintDefaults={nextSprintDefaults(
          sprints,
          project.sprintLengthDays,
          isoDateOf(new Date()),
        )}
        group={group}
        users={meta.users}
        filtered={hasActiveFilters(filters)}
        bulkOptions={meta}
      />
    </div>
  );
}
