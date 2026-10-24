import { type PlanningIssue, type StatusOption } from "@/lib/issues/views";
import { type ResolvedView } from "@/lib/views/view-defaults";

export interface BoardLayout<I extends Pick<PlanningIssue, "type" | "status">> {
  /** The columns shown, in workflow order (drop targets are exactly these). */
  columns: StatusOption[];
  /** Issues of the shown types (in every status): what the WIP warnings count against. */
  typed: I[];
  /** Issues of the shown types in hidden columns ("N issues in hidden columns"). */
  hiddenCount: number;
}

/**
 * BRD-6: which columns and cards the board shows for a view. The type filter keeps the
 * issues of the picked types (none picked = every type); hidden columns are left out, with
 * their (type-filtered) issues counted for the note. WIP counts (BRD-5) stay "the cards a
 * column shows" (`wip.ts`), so a type filter narrows them too, as the sprint scope does.
 * `view` must be normalised (`normaliseView`), so at least one column is left.
 */
export function boardLayout<I extends Pick<PlanningIssue, "type" | "status">>(
  issues: I[],
  statuses: StatusOption[],
  view: ResolvedView,
): BoardLayout<I> {
  const typed =
    view.types.length > 0 ? issues.filter((issue) => view.types.includes(issue.type)) : issues;
  const hidden = new Set(view.hidden);
  return {
    columns: statuses.filter((status) => !hidden.has(status.id)),
    typed,
    hiddenCount: typed.filter((issue) => hidden.has(issue.status.id)).length,
  };
}
