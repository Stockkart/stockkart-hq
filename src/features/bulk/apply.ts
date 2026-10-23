import { type BulkChange } from "@/lib/issues/bulk";
import {
  type LabelView,
  type NamedOption,
  type PlanningIssue,
  type StatusOption,
} from "@/lib/issues/views";

/** What the optimistic update needs to show names (the page's options). */
export interface BulkLookups {
  statuses: StatusOption[];
  users: NamedOption[];
  labels: LabelView[];
}

/**
 * ISS-12 optimistic update: the bulk change applied to the shown issues, as the server will
 * apply it (a delete removes them). Isomorphic and pure; unknown ids change nothing.
 */
export function applyBulkChange<T extends PlanningIssue>(
  issues: readonly T[],
  ids: ReadonlySet<string>,
  change: BulkChange,
  lookups: BulkLookups,
): T[] {
  if (change.kind === "delete") return issues.filter((issue) => !ids.has(issue.id));
  return issues.map((issue) => {
    if (!ids.has(issue.id)) return issue;
    switch (change.kind) {
      case "status": {
        const status = lookups.statuses.find((option) => option.id === change.statusId);
        return status ? { ...issue, status } : issue;
      }
      case "priority":
        return { ...issue, priority: change.priority };
      case "assignee": {
        if (change.assigneeId === null) return { ...issue, assignee: null };
        const user = lookups.users.find((option) => option.id === change.assigneeId);
        return user ? { ...issue, assignee: { id: user.id, name: user.name } } : issue;
      }
      case "sprint":
        return { ...issue, sprintId: change.sprintId };
      case "release":
        return { ...issue, releaseId: change.releaseId };
      case "addLabels": {
        const added = lookups.labels.filter(
          (label) =>
            change.labelIds.includes(label.id) && !issue.labels.some((l) => l.id === label.id),
        );
        const labels = [...issue.labels, ...added].sort((a, b) => a.name.localeCompare(b.name));
        return { ...issue, labels };
      }
      case "removeLabels":
        return {
          ...issue,
          labels: issue.labels.filter((label) => !change.labelIds.includes(label.id)),
        };
    }
  });
}
