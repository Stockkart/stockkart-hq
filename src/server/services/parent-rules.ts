import { ISSUE_TYPE_LABELS, type IssueType } from "@/lib/issues/constants";

/**
 * ISS-3 parent rules, enforced on the server for create and for every parent change:
 * - Story / Task / Bug / Spike / Tech-debt → optional parent, which must be an Epic.
 * - Subtask → required parent, any non-epic issue. A subtask cannot parent another subtask,
 *   which keeps the hierarchy at most three levels deep and makes cycles impossible.
 * - Epic → no parent.
 * The parent must be another, non-deleted issue in the same project.
 */

export interface ParentCandidate {
  id: string;
  projectId: string;
  type: IssueType;
  deletedAt: Date | null;
}

export interface ParentChild {
  /** Absent when the child is being created. */
  id?: string;
  projectId: string;
  type: IssueType;
}

/** Returns why `parent` is not allowed for `child`, or null when it is. */
export function parentProblem(child: ParentChild, parent: ParentCandidate | null): string | null {
  if (!parent) {
    return child.type === "subtask" ? "A subtask needs a parent issue" : null;
  }
  if (child.type === "epic") return "An epic cannot have a parent";
  if (parent.id === child.id) return "An issue cannot be its own parent";
  if (parent.deletedAt) return "The parent issue has been deleted";
  if (parent.projectId !== child.projectId) return "The parent must be in the same project";
  if (child.type === "subtask") {
    if (parent.type === "epic") return "A subtask's parent cannot be an epic";
    if (parent.type === "subtask") return "A subtask cannot be the parent of another subtask";
    return null;
  }
  if (parent.type !== "epic") {
    return `A ${ISSUE_TYPE_LABELS[child.type].toLowerCase()}'s parent must be an epic`;
  }
  return null;
}
