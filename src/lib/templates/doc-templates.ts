import { type DocType } from "@/lib/docs/constants";
import { rt, type RichTextNode } from "@/lib/rich-text";

import { type BuiltInTemplate } from "./issue-templates";

/**
 * DOC-5 / SPEC §6.1 built-in doc templates. The seed upserts these into `templates` (kind
 * `doc`). `subtype` is the doc type a new doc gets ("New from template" sets `docs.type` from
 * it); the code review checklist has no doc type of its own and makes a `page`.
 *
 * S-7: prompts only, no real Stockkart data. The ADR template mirrors the section structure
 * of `engineering-handbook/decisions/0000-template.md` (Status · Context · Decision ·
 * Consequences · Evidence (paths)); the code review checklist mirrors the section structure
 * of the handbook's review rubric.
 */

const h2 = (text: string) => rt.heading(2, text);
const h3 = (text: string) => rt.heading(3, text);
const p = (text: string) => rt.paragraph(text);

function table(headers: string[], rows: string[][]): RichTextNode {
  const cell = (type: "tableHeader" | "tableCell", text: string): RichTextNode => ({
    type,
    content: [rt.paragraph(text || undefined)],
  });
  return {
    type: "table",
    content: [
      { type: "tableRow", content: headers.map((text) => cell("tableHeader", text)) },
      ...rows.map((row) => ({
        type: "tableRow",
        content: row.map((text) => cell("tableCell", text)),
      })),
    ],
  };
}

const mermaid = (source: string): RichTextNode => ({ type: "mermaid", attrs: { source } });

const callout = (text: string): RichTextNode => ({
  type: "callout",
  attrs: { tone: "info" },
  content: [rt.paragraph(text)],
});

export type DocTemplateSubtype = DocType | "code_review_checklist";

export const BUILT_IN_DOC_TEMPLATES: (BuiltInTemplate & { subtype: DocTemplateSubtype })[] = [
  {
    subtype: "adr",
    name: "ADR",
    description: "One decision: status, context, decision, consequences and evidence.",
    content: rt.doc(
      h2("Status"),
      p("Proposed. Recorded against inventory-api `<sha>` and inventory-platform `<sha>`."),
      h2("Context"),
      rt.bullets(
        "The force or problem, as visible in code.",
        "Supersedes: NNNN. Only when this ADR replaces one.",
        'Reason: "<quoted reason>" (<source>). Or: Reason not recorded.',
      ),
      h2("Decision"),
      rt.bullets("What the code does. One fact per bullet."),
      h2("Consequences"),
      rt.bullets("Effects visible today, good and bad. One per bullet."),
      h2("Evidence (paths)"),
      rt.bullets(
        "inventory-api: <path>",
        "inventory-platform: <path>",
        "Rules: the AGENTS.md rule IDs or sections this follows.",
      ),
    ),
  },
  {
    subtype: "design",
    name: "Design doc (HLD)",
    description: "High-level design: problem, proposal, alternatives, data, rollout and risks.",
    content: rt.doc(
      h2("Summary"),
      p("Two or three sentences: what changes and why it matters."),
      h2("Problem & goals"),
      rt.bullets("What hurts today, with evidence.", "What success looks like, measurably."),
      h2("Non-goals"),
      rt.bullets("What this design deliberately does not cover."),
      h2("Before/after diagram"),
      mermaid("flowchart LR\n  Before[Today] --> After[Proposed]"),
      h2("Proposed design"),
      p("Components, responsibilities and how a request flows through them."),
      h2("Alternatives considered"),
      table(["Option", "Pros", "Cons", "Why not"], [["", "", "", ""]]),
      h2("Data model"),
      p("New or changed collections/tables, fields and indexes."),
      h2("API changes"),
      p("New or changed endpoints, with request and response shapes."),
      h2("Rollout & migration"),
      rt.checklist("Feature flag or staged rollout", "Data migration plan", "Rollback plan"),
      h2("Risks"),
      rt.bullets("Risk, likelihood and mitigation."),
      h2("Open questions"),
      rt.bullets("Question, and who can answer it."),
    ),
  },
  {
    subtype: "lld",
    name: "LLD",
    description: "Low-level design: components, sequences, schema, errors, concurrency, tests.",
    content: rt.doc(
      h2("Components & responsibilities"),
      table(["Component", "Responsibility", "Owner"], [["", "", ""]]),
      h2("Sequence diagrams (Mermaid)"),
      mermaid(
        "sequenceDiagram\n  participant C as Client\n  participant A as API\n  participant D as DB\n  C->>A: request\n  A->>D: query\n  D-->>A: rows\n  A-->>C: response",
      ),
      h2("Data structures/schema"),
      p("Types, documents or tables, with field-level notes."),
      h2("Error handling"),
      rt.bullets("Which errors can happen, and what the caller sees for each."),
      h2("Concurrency & idempotency"),
      rt.bullets("What happens when two requests race.", "Which operations are safe to retry."),
      h2("Config"),
      rt.bullets("New settings, defaults and where they are set."),
      h2("Testing plan"),
      rt.checklist("Unit tests", "Integration tests", "Load or failure tests"),
    ),
  },
  {
    subtype: "rfc",
    name: "RFC",
    description: "A proposal for discussion: motivation, design, drawbacks and alternatives.",
    content: rt.doc(
      h2("Proposal"),
      p("One paragraph: what you propose."),
      h2("Motivation"),
      p("Why now, and what happens if we do nothing."),
      h2("Detailed design"),
      p("Enough detail that someone else could build it."),
      h2("Drawbacks"),
      rt.bullets("Costs, risks and complexity this adds."),
      h2("Alternatives"),
      rt.bullets("Other ways to solve it, and why this one is better."),
      h2("Unresolved questions"),
      rt.bullets("What must be answered before or during the work."),
      h2("Decision"),
      p("Outcome of the discussion. Link the ADR that records it."),
    ),
  },
  {
    subtype: "api_contract",
    name: "API contract",
    description: "Endpoints, examples, error envelope, auth, versioning and changelog.",
    content: rt.doc(
      h2("Endpoint table"),
      table(["Method", "Path", "Purpose", "Auth"], [["GET", "/api/v1/…", "", ""]]),
      h2("Request/response examples"),
      { type: "codeBlock", attrs: { language: "json" }, content: [{ type: "text", text: "{}" }] },
      h2("Error envelope"),
      p("The shape of every error response and the list of error codes."),
      h2("Auth"),
      p("How callers authenticate, and which roles may call what."),
      h2("Versioning"),
      p("How breaking changes are introduced and announced."),
      h2("Changelog"),
      table(["Date", "Change", "Breaking?"], [["", "", ""]]),
    ),
  },
  {
    subtype: "runbook",
    name: "Runbook",
    description: "What runs where, where to look, and what to do when an alarm fires.",
    content: rt.doc(
      h2("Service overview"),
      p("What it does, where it runs, and what depends on it."),
      h2("Dashboards/logs links"),
      rt.bullets("Dashboard:", "Logs:", "Database console:"),
      callout("Never paste secrets or connection strings into this page."),
      h2("Alarms → actions table"),
      table(["Alarm", "Meaning", "First action"], [["", "", ""]]),
      h2("Common procedures"),
      rt.bullets("Procedure name: steps, one per line."),
      h2("Rollback"),
      rt.checklist("Identify the last good version", "Redeploy it", "Verify health"),
      h2("Escalation"),
      p("Who to contact, in order, and how."),
    ),
  },
  {
    subtype: "postmortem",
    name: "Incident postmortem",
    description: "Blameless review: impact, timeline, root cause and action items.",
    content: rt.doc(
      h2("Summary"),
      p("What happened, in two sentences."),
      h2("Impact"),
      rt.bullets("Who was affected, for how long, and how badly."),
      h2("Timeline"),
      table(["Time", "Event"], [["", ""]]),
      h2("Root cause (5 whys)"),
      {
        type: "orderedList",
        content: ["Why?", "Why?", "Why?", "Why?", "Why?"].map((text) => ({
          type: "listItem",
          content: [rt.paragraph(text)],
        })),
      },
      h2("What went well/badly"),
      h3("Went well"),
      rt.bullets(""),
      h3("Went badly"),
      rt.bullets(""),
      h2("Action items (linked issues)"),
      rt.checklist("STK-… action item"),
    ),
  },
  {
    subtype: "load_test_report",
    name: "Load-test report",
    description: "Goal, setup, scenarios, results, findings and follow-ups.",
    content: rt.doc(
      h2("Goal"),
      p("The question this test answers."),
      h2("Setup (tool, env, data)"),
      rt.bullets("Tool:", "Environment:", "Data set:"),
      h2("Scenarios"),
      rt.bullets("Scenario: users, ramp, duration."),
      h2("Results table"),
      table(
        ["Scenario", "RPS", "p50", "p95", "p99", "Errors", "Memory"],
        [["", "", "", "", "", "", ""]],
      ),
      h2("Findings"),
      rt.bullets("What the numbers mean."),
      h2("Follow-ups"),
      rt.checklist("STK-… follow-up"),
    ),
  },
  {
    subtype: "retro",
    name: "Sprint retro",
    description: "Was the goal met, what went well, what did not, what to try next.",
    content: rt.doc(
      h2("Sprint goal met?"),
      p("Yes / partly / no, and why."),
      h2("Went well"),
      rt.bullets(""),
      h2("Didn't go well"),
      rt.bullets(""),
      h2("Try next"),
      rt.bullets(""),
      h2("Action items"),
      rt.checklist(""),
    ),
  },
  {
    subtype: "release_notes",
    name: "Release notes",
    description: "Version, date, features, fixes, breaking changes and migration steps.",
    content: rt.doc(
      h2("Version"),
      p("e.g. api-v1.4"),
      h2("Date"),
      p("YYYY-MM-DD"),
      h2("Features"),
      rt.bullets("STK-… feature"),
      h2("Fixes"),
      rt.bullets("STK-… fix"),
      h2("Breaking changes"),
      rt.bullets("None."),
      h2("Migration steps"),
      rt.checklist(""),
    ),
  },
  {
    subtype: "meeting_notes",
    name: "Meeting notes",
    description: "Date, attendees, agenda, notes, decisions and action items.",
    content: rt.doc(
      h2("Date"),
      p("YYYY-MM-DD"),
      h2("Attendees"),
      rt.bullets(""),
      h2("Agenda"),
      rt.bullets(""),
      h2("Notes"),
      p(""),
      h2("Decisions"),
      rt.bullets(""),
      h2("Action items"),
      rt.checklist("Owner: action"),
    ),
  },
  {
    subtype: "onboarding",
    name: "Onboarding",
    description: "Repos and setup, an architecture tour, conventions and first tasks.",
    content: rt.doc(
      h2("Repos & setup"),
      rt.checklist("Get repo access", "Clone and run each repo locally", "Run the tests"),
      h2("Architecture tour"),
      p("Start with the architecture doc and the ADR log; then follow one request end to end."),
      h2("Conventions (links AGENTS.md)"),
      rt.bullets("Each repo's AGENTS.md holds its coding and review rules."),
      h2("First tasks"),
      rt.checklist("A small fix to learn the flow", "A reviewed change in each repo"),
    ),
  },
  {
    subtype: "code_review_checklist",
    name: "Code review checklist",
    description: "Review checklist by area, severity levels and the definition of done.",
    content: rt.doc(
      h2("How to use this checklist"),
      p("Go through each area; note findings with a severity."),
      h2("Code review checklist"),
      h3("Architecture"),
      rt.checklist("Fits the existing module boundaries"),
      h3("Correctness"),
      rt.checklist("Edge cases and error paths are handled"),
      h3("Cross-repo contract"),
      rt.checklist("API changes are mirrored in the client and the contract doc"),
      h3("Tests"),
      rt.checklist("New behaviour has tests; failing paths too"),
      h3("Security"),
      rt.checklist("Input validated, access checked, no secrets in code or logs"),
      h3("Writing style"),
      rt.checklist("Names, comments and messages are clear"),
      h3("Scope discipline"),
      rt.checklist("Only what the task needs"),
      h3("Unrelated changes"),
      rt.checklist("No drive-by changes mixed in"),
      h3("Conventions compliance"),
      rt.checklist("Follows the repo's AGENTS.md"),
      h2("Severity"),
      table(
        ["Level", "Meaning"],
        [
          ["Blocker", ""],
          ["Major", ""],
          ["Minor", ""],
        ],
      ),
      h2("Definition of done"),
      rt.checklist("Builds, tests pass, reviewed, docs updated"),
    ),
  },
];
