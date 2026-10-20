import { type BacklogGroup } from "@/lib/issues/filters";
import { type PlanningIssue } from "@/lib/issues/views";

/** One BLG-2 backlog section. */
export interface IssueGroup {
  /** Stable id for collapse state: the epic/component/user id, or `none`. */
  id: string;
  label: string;
  issues: PlanningIssue[];
  /** BLG-4 total story points of the section. */
  points: number;
}

const NO_GROUP_LABELS: Record<Exclude<BacklogGroup, "none">, string> = {
  epic: "No epic",
  component: "No component",
  assignee: "Unassigned",
};

function keyOf(
  issue: PlanningIssue,
  group: Exclude<BacklogGroup, "none">,
): { id: string; label: string } | null {
  switch (group) {
    case "epic":
      return issue.epic
        ? { id: issue.epic.id, label: `${issue.epic.key} ${issue.epic.title}` }
        : null;
    case "component":
      return issue.component ? { id: issue.component.id, label: issue.component.name } : null;
    case "assignee":
      return issue.assignee ? { id: issue.assignee.id, label: issue.assignee.name } : null;
  }
}

export const sumPoints = (issues: readonly PlanningIssue[]) =>
  issues.reduce((total, issue) => total + (issue.storyPoints ?? 0), 0);

/**
 * Splits the rank-ordered backlog into sections, keeping rank order inside each. Sections
 * appear in the order of their highest-ranked issue; the "No …" section always comes last.
 */
export function groupIssues(issues: readonly PlanningIssue[], group: BacklogGroup): IssueGroup[] {
  if (group === "none") {
    return [{ id: "none", label: "Backlog", issues: [...issues], points: sumPoints(issues) }];
  }
  const sections = new Map<string, { label: string; issues: PlanningIssue[] }>();
  const ungrouped: PlanningIssue[] = [];
  for (const issue of issues) {
    const key = keyOf(issue, group);
    if (!key) {
      ungrouped.push(issue);
      continue;
    }
    const section = sections.get(key.id) ?? { label: key.label, issues: [] };
    section.issues.push(issue);
    sections.set(key.id, section);
  }
  const result: IssueGroup[] = [...sections].map(([id, section]) => ({
    id,
    label: section.label,
    issues: section.issues,
    points: sumPoints(section.issues),
  }));
  if (ungrouped.length > 0) {
    result.push({
      id: "none",
      label: NO_GROUP_LABELS[group],
      issues: ungrouped,
      points: sumPoints(ungrouped),
    });
  }
  return result;
}
