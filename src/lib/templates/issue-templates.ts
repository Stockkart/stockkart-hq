import { type IssueType } from "@/lib/issues/constants";
import { rt, type RichTextDoc } from "@/lib/rich-text";

/**
 * ISS-10 / SPEC §6.2 built-in issue templates. The seed upserts these into `templates`
 * (kind `issue`, subtype = issue type); quick create reads them from there.
 */
export interface BuiltInTemplate {
  subtype: string;
  name: string;
  description: string;
  content: RichTextDoc;
}

export const BUILT_IN_ISSUE_TEMPLATES: (BuiltInTemplate & { subtype: IssueType })[] = [
  {
    subtype: "bug",
    name: "Bug",
    description: "Steps to reproduce, expected and actual behaviour, environment, logs.",
    content: rt.doc(
      rt.heading(3, "Steps to reproduce"),
      {
        type: "orderedList",
        content: [{ type: "listItem", content: [rt.paragraph()] }],
      },
      rt.heading(3, "Expected"),
      rt.paragraph(),
      rt.heading(3, "Actual"),
      rt.paragraph(),
      rt.heading(3, "Environment"),
      rt.bullets("api version:", "platform version:", "browser:"),
      rt.heading(3, "Logs / screenshots"),
      rt.paragraph(),
      rt.heading(3, "Severity notes"),
      rt.paragraph(),
    ),
  },
  {
    subtype: "story",
    name: "Story",
    description: "User story with acceptance criteria and a design link.",
    content: rt.doc(
      rt.paragraph("As a … I want … so that …"),
      rt.heading(3, "Acceptance criteria"),
      rt.checklist(""),
      rt.heading(3, "Design"),
      rt.paragraph(),
    ),
  },
  {
    subtype: "spike",
    name: "Spike",
    description: "A time-boxed question with findings and a recommendation.",
    content: rt.doc(
      rt.heading(3, "Question to answer"),
      rt.paragraph(),
      rt.heading(3, "Time box"),
      rt.paragraph(),
      rt.heading(3, "Findings"),
      rt.paragraph(),
      rt.heading(3, "Recommendation"),
      rt.paragraph(),
    ),
  },
  {
    subtype: "tech_debt",
    name: "Tech-debt",
    description: "Current state, why it hurts, the fix and the risk of not fixing.",
    content: rt.doc(
      rt.heading(3, "Current state"),
      rt.paragraph(),
      rt.heading(3, "Why it hurts"),
      rt.paragraph(),
      rt.heading(3, "Proposed fix"),
      rt.paragraph(),
      rt.heading(3, "Risk of not fixing"),
      rt.paragraph(),
    ),
  },
];
