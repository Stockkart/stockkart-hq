import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { syntheticHandbook } from "./fixtures";
import { planHandbookImport, readHandbookDir } from "./handbook";

describe("planHandbookImport (IMP-1)", () => {
  const plan = planHandbookImport(syntheticHandbook());

  it("groups top-level docs under Handbook and ADRs under Decisions, in order", () => {
    expect(plan.docs.map((doc) => [doc.kind, doc.sourcePath, doc.parentPath])).toEqual([
      ["group", ".", null],
      ["doc", "README.md", "."],
      ["doc", "ARCHITECTURE.md", "."],
      ["doc", "RUNBOOK.md", "."],
      ["doc", "NOTES.md", "."],
      ["group", "decisions", "."],
      ["adr", "decisions/0001-first-choice.md", "decisions"],
      ["adr", "decisions/0002-second-choice.md", "decisions"],
      ["adr", "decisions/0003-third-choice.md", "decisions"],
    ]);
  });

  it("maps file names to doc types and takes titles from the H1", () => {
    const docs = plan.docs.flatMap((doc) => (doc.kind === "doc" ? [doc] : []));
    expect(docs.map((doc) => [doc.title, doc.type])).toEqual([
      ["Demo handbook", "page"],
      ["Demo architecture", "design"],
      ["Demo runbook", "runbook"],
      ["NOTES", "page"],
    ]);
    // The H1 is the title, not part of the body; mermaid fences are Mermaid blocks.
    expect(docs[1]?.content.content?.[0]).toEqual({
      type: "mermaid",
      attrs: { source: "flowchart LR\n  A --> B" },
    });
    expect(plan.warnings).toEqual(['NOTES.md: no "# Title" line; using the file name']);
  });

  it("parses ADR numbers, titles and statuses, including Superseded by", () => {
    const adrs = plan.docs.flatMap((doc) => (doc.kind === "adr" ? [doc] : []));
    expect(adrs.map((adr) => [adr.number, adr.title, adr.status, adr.supersededByNumber])).toEqual([
      [1, "0001. First choice", "accepted_retrospective", null],
      [2, "0002. Second choice", "superseded", 3],
      [3, "0003. Third choice", "accepted", null],
    ]);
  });

  it("skips the ADR template and other files", () => {
    expect(plan.skipped).toEqual([
      { path: "decisions/0000-template.md", reason: "ADR template" },
      {
        path: "decisions/README.md",
        reason: "not a top-level doc or a decisions/NNNN-*.md ADR",
      },
    ]);
  });

  it("reads top-level and decisions/ markdown from a directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hq-handbook-"));
    try {
      await mkdir(path.join(dir, "decisions"));
      await mkdir(path.join(dir, "other"));
      await writeFile(path.join(dir, "README.md"), "# R\n");
      await writeFile(path.join(dir, "notes.txt"), "ignored");
      await writeFile(path.join(dir, "other", "X.md"), "# ignored\n");
      await writeFile(path.join(dir, "decisions", "0001-a.md"), "# 0001. A\n");
      const files = await readHandbookDir(dir);
      expect(files.map((file) => file.path)).toEqual(["README.md", "decisions/0001-a.md"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
