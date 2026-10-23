import { ISSUE_TYPE_LABELS, type IssueType } from "./constants";

/**
 * ISS-14 "Convert type" under the ISS-3 parent rules (`server/services/parent-rules.ts`):
 * after the change, the issue's own parent and every live child must still be allowed.
 * Isomorphic: the picker disables refused types with this reason, and the server checks
 * the same rules again (and once more inside the write, against concurrent changes).
 *
 * - Epic: no parent; children are stories, tasks, bugs, spikes or tech-debt.
 * - Subtask: needs a non-epic, non-subtask parent; has no children.
 * - Anything else: no parent or an epic parent; children are subtasks only.
 */

export interface ConvertSubject {
  type: IssueType;
  /** The current parent's type; null without a parent. */
  parentType: IssueType | null;
  /** Types of the live children. */
  childTypes: readonly IssueType[];
}

const article = (type: IssueType) => (type === "epic" ? "an" : "a");
const lower = (type: IssueType) => ISSUE_TYPE_LABELS[type].toLowerCase();

/** Why `issue` cannot become `target`, or null when it can. */
export function convertProblem(issue: ConvertSubject, target: IssueType): string | null {
  if (target === issue.type) return `It is already ${article(target)} ${lower(target)}`;
  const children = issue.childTypes.length;
  const plural = children === 1 ? "child issue" : "child issues";

  if (issue.type === "epic" && children > 0) {
    return `This epic has ${children} ${plural}; move ${children === 1 ? "it" : "them"} to another epic first`;
  }
  if (target === "epic") {
    if (issue.parentType !== null) return "An epic cannot have a parent; remove the parent first";
    if (issue.childTypes.includes("subtask")) {
      return "Its subtasks need a non-epic parent; move them first";
    }
    return null;
  }
  if (target === "subtask") {
    if (issue.parentType === null) return "A subtask needs a parent issue; set one first";
    if (issue.parentType === "epic") {
      return "A subtask's parent cannot be an epic; pick a non-epic parent first";
    }
    if (issue.parentType === "subtask") return "A subtask cannot be the parent of another subtask";
    if (children > 0) return `A subtask cannot have children; move its ${plural} first`;
    return null;
  }
  if (issue.parentType !== null && issue.parentType !== "epic") {
    return `A ${lower(target)}'s parent must be an epic; change or remove the parent first`;
  }
  return null;
}
