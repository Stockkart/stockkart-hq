import { type BacklogGroup } from "@/lib/issues/filters";
import { type PlanningIssue } from "@/lib/issues/views";
import { type SprintSummary } from "@/lib/sprints/views";

import { groupIssues, sumPoints } from "./groups";

/** The backlog's own container id (sprint sections use their sprint id). */
export const BACKLOG_CONTAINER = "backlog";

/** One section of the backlog page (BLG-2/3). */
export interface PlanningSection {
  /** Unique per section: the sprint id, or `backlog:<group id>`. */
  id: string;
  /** Where an issue dropped here goes: a sprint id or `BACKLOG_CONTAINER`. */
  container: string;
  label: string;
  /** Set for sprint sections. */
  sprint: SprintSummary | null;
  issues: PlanningIssue[];
  points: number;
}

/**
 * BLG-3 splits the rank-ordered planning list into sections, keeping rank order in each:
 *
 * 1. the active sprint (all of its issues, done ones included), then each planned sprint
 *    in start order (not-done issues only);
 * 2. the backlog: every other not-done issue (no sprint, or a closed one), grouped as
 *    BLG-2 says. The backlog always has at least one section, even when empty.
 */
export function planningSections(
  issues: readonly PlanningIssue[],
  sprints: readonly SprintSummary[],
  group: BacklogGroup,
): PlanningSection[] {
  const open = sprints.filter((sprint) => sprint.state !== "closed");
  const ordered = [
    ...open.filter((sprint) => sprint.state === "active"),
    ...open.filter((sprint) => sprint.state === "planned"),
  ];
  const openIds = new Set(ordered.map((sprint) => sprint.id));
  const sprintSections = ordered.map((sprint): PlanningSection => {
    const members = issues.filter(
      (issue) =>
        issue.sprintId === sprint.id &&
        (sprint.state === "active" || issue.status.category !== "done"),
    );
    return {
      id: sprint.id,
      container: sprint.id,
      label: sprint.name,
      sprint,
      issues: members,
      points: sumPoints(members),
    };
  });
  const backlog = issues.filter(
    (issue) =>
      issue.status.category !== "done" && (issue.sprintId === null || !openIds.has(issue.sprintId)),
  );
  const groups = groupIssues(backlog, group);
  const backlogSections = (
    groups.length > 0 ? groups : [{ id: "none", label: "Backlog", issues: [], points: 0 }]
  ).map((section): PlanningSection => ({
    ...section,
    id: `backlog:${section.id}`,
    container: BACKLOG_CONTAINER,
    sprint: null,
  }));
  return [...sprintSections, ...backlogSections];
}
