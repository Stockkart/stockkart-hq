import { DOC_TITLE_MAX } from "@/lib/docs/schemas";
import { rt, type RichTextDoc, type RichTextNode } from "@/lib/rich-text";

import { formatDateRange } from "./dates";

/**
 * SPR-5 sprint retro doc: the built-in `retro` template, preceded by what the sprint did
 * (goal, dates, the completed and the carried issues with their points). Issues are written
 * as their `STK-12` keys, which the doc renders as chips and links as mentions (ISS-7).
 * Isomorphic and pure, so it is tested without a database.
 */

/** The parent page every retro goes under (created at the top level if missing). */
export const RETROS_PAGE_TITLE = "Retros";

export interface RetroIssue {
  key: string;
  title: string;
  points: number | null;
}

export interface RetroInput {
  sprint: { name: string; goal: string | null; startDate: string | null; endDate: string | null };
  completed: readonly RetroIssue[];
  carried: readonly RetroIssue[];
  /** The built-in template's content; null when it is missing (then only the summary). */
  template: RichTextDoc | null;
}

/** "Retro — Sprint 4", cut to the doc title limit. */
export function retroTitle(sprintName: string): string {
  return `Retro — ${sprintName}`.slice(0, DOC_TITLE_MAX).replace(/[\uD800-\uDBFF]$/, "");
}

const sumPoints = (issues: readonly RetroIssue[]) =>
  issues.reduce((total, issue) => total + (issue.points ?? 0), 0);

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function issueList(issues: readonly RetroIssue[]): RichTextNode {
  if (issues.length === 0) return rt.paragraph("None.");
  return rt.bullets(
    ...issues.map(
      (issue) =>
        `${issue.key} ${issue.title}${issue.points !== null ? ` (${plural(issue.points, "pt", "pts")})` : ""}`,
    ),
  );
}

export function buildRetroDoc(input: RetroInput): RichTextDoc {
  const { sprint, completed, carried } = input;
  const completedPoints = sumPoints(completed);
  const carriedPoints = sumPoints(carried);
  return rt.doc(
    rt.heading(2, "Sprint"),
    rt.paragraph(`Goal: ${sprint.goal ?? "No goal was set."}`),
    rt.paragraph(`Dates: ${formatDateRange(sprint.startDate, sprint.endDate)}`),
    rt.paragraph(
      `Completed ${plural(completed.length, "issue", "issues")} (${plural(completedPoints, "point", "points")}); carried over ${plural(carried.length, "issue", "issues")} (${plural(carriedPoints, "point", "points")}).`,
    ),
    rt.heading(3, "Completed"),
    issueList(completed),
    rt.heading(3, "Carried over"),
    issueList(carried),
    ...(input.template?.content ?? []),
  );
}
