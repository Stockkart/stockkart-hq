import { type HandbookFile } from "./handbook";

/**
 * Small synthetic handbook for the import tests. Invented text only: real handbook content
 * must never be committed (S-7, IMP-3).
 */
export function syntheticHandbook(): HandbookFile[] {
  const adr = (number: string, title: string, status: string, extra = "") => ({
    path: `decisions/${number}-${title.toLowerCase().replace(/\s+/g, "-")}.md`,
    markdown: `# ${number}. ${title}\n\n## Status\n\n${status}\nRecorded against demo \`abc123\`.\n\n## Context\n\n- A made-up force.\n\n## Decision\n\n- A made-up fact.${extra}\n`,
  });
  return [
    { path: "README.md", markdown: "# Demo handbook\n\nStart here. See STK-1.\n" },
    {
      path: "ARCHITECTURE.md",
      markdown:
        "# Demo architecture\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n| Box | Role |\n| --- | --- |\n| A | first |\n",
    },
    { path: "RUNBOOK.md", markdown: "# Demo runbook\n\n- [ ] check the thing\n" },
    { path: "NOTES.md", markdown: "No heading here.\n" },
    { path: "decisions/0000-template.md", markdown: "# NNNN. Title\n\n## Status\n\nAccepted\n" },
    { path: "decisions/README.md", markdown: "# Index\n" },
    adr("0001", "First choice", "Accepted (recorded retrospectively)."),
    adr("0002", "Second choice", "Superseded by [0003](0003-third-choice.md)."),
    adr("0003", "Third choice", "Accepted.", "\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```"),
  ];
}
