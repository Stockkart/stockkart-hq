import { describe, expect, it } from "vitest";

import { sortMarks } from "@/lib/markdown/from-rich-text";
import { markdownToRichText, sectionText, takeTitle } from "@/lib/markdown/to-rich-text";
import { planHandbookImport } from "@/server/import/handbook";

import { parseAdrStatus } from "./adr";
import { type AdrStatus } from "./constants";
import { docToMarkdown, type MarkdownExportDoc } from "./markdown-export";

/**
 * A synthetic ADR with exactly the section structure of the handbook's
 * `decisions/0000-template.md` (Status, Context, Decision, Consequences, Evidence (paths)).
 * The wording is made up: no handbook content is copied into this repo (S-7).
 */
const SYNTHETIC_ADR = [
  "# 0042. Cache widget lookups in memory",
  "",
  "## Status",
  "",
  "Accepted (recorded retrospectively).",
  "Recorded against inventory-api `0123abc` and inventory-platform `4567def`.",
  "",
  "## Context",
  "",
  "- Widget lookups hit the database on every request.",
  "- Supersedes: [0007](0007-no-widget-cache.md).",
  '- Reason: "lookups were slow" (`synthetic-source`).',
  "",
  "## Decision",
  "",
  "- A per-instance map holds widgets for five minutes.",
  "",
  "## Consequences",
  "",
  "- Fewer queries.",
  "- Stale reads for up to five minutes.",
  "",
  "## Evidence (paths)",
  "",
  "- inventory-api: `src/widgets/cache.ts`",
  "- inventory-platform: `apps/web/widgets.tsx`",
  '- Rules: [backend AGENTS.md](https://example.test/backend/AGENTS.md) R-1; [frontend AGENTS.md](https://example.test/frontend/AGENTS.md) "Caching".',
  "",
].join("\n");

/** What the handbook import makes of a file (the planner, without a database). */
function imported(path: string, markdown: string) {
  const [planned] = planHandbookImport([{ path, markdown }]).docs.filter(
    (doc) => doc.kind === "adr" || doc.kind === "doc",
  );
  if (!planned) throw new Error("nothing planned");
  return planned;
}

function adrDoc(overrides: Partial<MarkdownExportDoc> = {}): MarkdownExportDoc {
  const planned = imported("decisions/0042-cache-widget-lookups.md", SYNTHETIC_ADR);
  if (planned.kind !== "adr") throw new Error("not an ADR");
  return {
    type: "adr",
    title: planned.title,
    content: planned.content,
    projectKey: "STK",
    adrNumber: planned.number,
    adrStatus: planned.status,
    sourcePath: planned.sourcePath,
    ...overrides,
  };
}

describe("docToMarkdown (DOC-12)", () => {
  it("exports an imported ADR in the template's structure, and it imports back the same", () => {
    const exported = docToMarkdown(adrDoc());
    expect(exported.path).toBe("decisions/0042-cache-widget-lookups.md");
    expect(exported.fileName).toBe("0042-cache-widget-lookups.md");
    const lines = exported.markdown.split("\n");
    expect(lines.slice(0, 5)).toEqual([
      "# 0042. Cache widget lookups in memory",
      "",
      "## Status",
      "",
      "`Accepted (recorded retrospectively)`. Recorded against inventory-api `0123abc` and inventory-platform `4567def`.",
    ]);
    expect(lines.filter((line) => line.startsWith("## "))).toEqual([
      "## Status",
      "## Context",
      "## Decision",
      "## Consequences",
      "## Evidence (paths)",
    ]);
    expect(exported.markdown).toContain("- Supersedes: [0007](0007-no-widget-cache.md).");
    expect(exported.markdown).toContain("- inventory-api: `src/widgets/cache.ts`");

    // The import reads the same ADR back: number, title, status and (normalised) content.
    const again = imported(exported.path, exported.markdown);
    const first = adrDoc();
    expect(again).toMatchObject({
      kind: "adr",
      number: 42,
      title: "0042. Cache widget lookups in memory",
      status: "accepted_retrospective",
      supersededByNumber: null,
    });
    // The status phrase is now code-formatted (the template's style); the rest is equal.
    const body = (markdown: string) =>
      takeTitle(markdownToRichText(markdown)).doc.content?.slice(2);
    expect(sortMarks({ type: "doc", content: body(exported.markdown) })).toEqual(
      sortMarks({ type: "doc", content: body(SYNTHETIC_ADR) }),
    );
    // Exporting the re-import is byte-identical (stable after one pass).
    expect(docToMarkdown({ ...first, content: again.content }).markdown).toBe(exported.markdown);
  });

  it.each<[AdrStatus, string, string]>([
    ["proposed", "`Proposed`.", "proposed"],
    ["accepted", "`Accepted`.", "accepted"],
    ["accepted_retrospective", "`Accepted (recorded retrospectively)`.", "accepted_retrospective"],
    ["deprecated", "`Deprecated`.", "deprecated"],
    ["superseded", "`Superseded`.", "superseded"],
  ])("writes status %s from the columns, not from stale text", (status, line, parsed) => {
    const { markdown } = docToMarkdown(adrDoc({ adrStatus: status }));
    expect(markdown).toContain(`## Status\n\n${line} Recorded against`);
    const text = sectionText(markdownToRichText(markdown), "Status") ?? "";
    expect(parseAdrStatus(text)?.status).toBe(parsed);
  });

  it('writes "Superseded by [NNNN](NNNN-slug.md)" with a link to the successor\'s file', () => {
    const { markdown } = docToMarkdown(
      adrDoc({
        adrStatus: "superseded",
        supersededBy: { title: "0050. Shared widget cache", adrNumber: 50 },
      }),
    );
    expect(markdown).toContain(
      "## Status\n\nSuperseded by [0050](0050-shared-widget-cache.md). Recorded against",
    );
    expect(parseAdrStatus(sectionText(markdownToRichText(markdown), "Status") ?? "")).toEqual({
      status: "superseded",
      supersededBy: 50,
    });
    // A successor imported from elsewhere links to its own file.
    expect(
      docToMarkdown(
        adrDoc({
          adrStatus: "superseded",
          supersededBy: { title: "x", adrNumber: 51, sourcePath: "decisions/0051-renamed.md" },
        }),
      ).markdown,
    ).toContain("Superseded by [0051](0051-renamed.md).");
  });

  it("adds a Status section to an ADR that has none, and numbers the title", () => {
    const { markdown, path } = docToMarkdown({
      type: "adr",
      title: "Use queues",
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }],
      },
      projectKey: "STK",
      adrNumber: 7,
      adrStatus: "accepted",
    });
    expect(path).toBe("decisions/0007-use-queues.md");
    expect(markdown).toBe("# 0007. Use queues\n\n## Status\n\n`Accepted`.\n\nBody\n");
  });

  it("exports other docs with their title and a top-level UPPER_SNAKE name", () => {
    const exported = docToMarkdown({
      type: "runbook",
      title: "On-call runbook",
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Steps" }] }],
      },
      projectKey: "STK",
      adrNumber: null,
      adrStatus: null,
    });
    expect(exported).toEqual({
      path: "ON_CALL_RUNBOOK.md",
      fileName: "ON_CALL_RUNBOOK.md",
      markdown: "# On-call runbook\n\nSteps\n",
    });
    const back = imported("ON_CALL_RUNBOOK.md", exported.markdown);
    expect(back.title).toBe("On-call runbook");
    expect(
      docToMarkdown({
        type: "runbook",
        title: back.title,
        content: back.content,
        projectKey: "STK",
        adrNumber: null,
        adrStatus: null,
        sourcePath: back.sourcePath,
      }).markdown,
    ).toBe(exported.markdown);
  });

  it("handles a doc without content", () => {
    expect(
      docToMarkdown({
        type: "page",
        title: "Empty",
        content: null,
        projectKey: "STK",
        adrNumber: null,
        adrStatus: null,
      }).markdown,
    ).toBe("# Empty\n");
  });
});
