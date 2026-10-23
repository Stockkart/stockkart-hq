import { rt, type RichTextDoc, type RichTextNode } from "@/lib/rich-text";
import { WONT_DO_STATUS_NAME } from "@/lib/sprints/constants";

import { RELEASE_NOTE_SECTIONS } from "./constants";
import { type ReleaseIssue } from "./views";

/**
 * REL-2 release-notes content, built from the release and its issues. Pure and isomorphic,
 * so the same input always gives the same doc (the generator compares it with the stored
 * doc to stay idempotent).
 *
 * Layout follows the built-in `release_notes` template: Version, Date, then one section per
 * `RELEASE_NOTE_SECTIONS` entry listing the release's done issues (Won't Do excluded) as
 * "STK-12 Title" (the key renders as an issue chip and becomes a DOC-9 mention link), and
 * empty "Breaking changes" and "Migration steps" sections for a human to fill in.
 */

export interface ReleaseNotesInput {
  name: string;
  /** Target date, ISO `YYYY-MM-DD`. */
  releaseDate: string | null;
  releasedAt: Date | null;
  issues: readonly ReleaseIssue[];
}

/** The issues a release's notes list: done-category ones, except Won't Do. */
export function shippedIssues(issues: readonly ReleaseIssue[]): ReleaseIssue[] {
  return issues.filter(
    (issue) => issue.status.category === "done" && issue.status.name !== WONT_DO_STATUS_NAME,
  );
}

/** The date the notes show: the day it was released (UTC), else the target date. */
export function notesDate(input: Pick<ReleaseNotesInput, "releaseDate" | "releasedAt">): string {
  if (input.releasedAt) return input.releasedAt.toISOString().slice(0, 10);
  return input.releaseDate ?? "Not set";
}

function issueList(issues: readonly ReleaseIssue[]): RichTextNode {
  if (issues.length === 0) return rt.paragraph("None.");
  return {
    type: "bulletList",
    content: issues.map((issue) => ({
      type: "listItem",
      content: [rt.paragraph(`${issue.key} ${issue.title}`)],
    })),
  };
}

export function buildReleaseNotes(input: ReleaseNotesInput): RichTextDoc {
  const shipped = shippedIssues(input.issues).sort((a, b) => a.number - b.number);
  const sections = RELEASE_NOTE_SECTIONS.flatMap((section) => [
    rt.heading(2, section.title),
    issueList(shipped.filter((issue) => section.types.includes(issue.type))),
  ]);
  return rt.doc(
    rt.heading(2, "Version"),
    rt.paragraph(input.name),
    rt.heading(2, "Date"),
    rt.paragraph(notesDate(input)),
    ...sections,
    rt.heading(2, "Breaking changes"),
    { type: "bulletList", content: [{ type: "listItem", content: [rt.paragraph()] }] },
    rt.heading(2, "Migration steps"),
    rt.checklist(""),
  );
}
