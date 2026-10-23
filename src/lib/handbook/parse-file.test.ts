import { describe, expect, it } from "vitest";

import { isImportableHandbookFile, parsePulledFile } from "./parse-file";

describe("parsePulledFile (DOC-14 pull)", () => {
  it("reads an ADR's title and status like the importer, keeping HQ's number", () => {
    const pulled = parsePulledFile(
      { type: "adr", title: "0003. Old title", adrNumber: 3 },
      "# 0009. Use a queue\n\n## Status\n\nSuperseded by [0010](0010-x.md).\n\n## Context\n\nText.\n",
    );
    expect(pulled?.title).toBe("0003. Use a queue");
    expect(pulled?.adr).toEqual({ status: "superseded", supersededByNumber: 10 });
    expect(JSON.stringify(pulled?.content)).toContain("Context");
    expect(JSON.stringify(pulled?.content)).not.toContain("0009. Use a queue");
  });

  it("keeps the ADR status when the file has none it recognises", () => {
    const pulled = parsePulledFile(
      { type: "adr", title: "0004. X", adrNumber: 4 },
      "# 0004. X\n\n## Status\n\nUnder discussion.\n",
    );
    expect(pulled?.adr).toEqual({ status: null, supersededByNumber: null });
    expect(
      parsePulledFile(
        { type: "adr", title: "0004. X", adrNumber: 4 },
        "# 0004. X\n\n## Status\n\n`Accepted`.\n",
      )?.adr?.status,
    ).toBe("accepted");
  });

  it("takes a page's title from `# Title`, else keeps the doc's", () => {
    expect(
      parsePulledFile({ type: "runbook", title: "Old", adrNumber: null }, "# Runbook\n\nBody.\n"),
    ).toMatchObject({
      title: "Runbook",
      adr: null,
    });
    expect(
      parsePulledFile({ type: "page", title: "Kept", adrNumber: null }, "Body only.\n")?.title,
    ).toBe("Kept");
  });
});

describe("isImportableHandbookFile", () => {
  it("accepts top-level files and decisions/NNNN ADRs except the template", () => {
    expect(isImportableHandbookFile("RUNBOOK.md")).toBe(true);
    expect(isImportableHandbookFile("decisions/0012-new.md")).toBe(true);
    expect(isImportableHandbookFile("decisions/0000-template.md")).toBe(false);
    expect(isImportableHandbookFile("guides/setup.md")).toBe(false);
    expect(isImportableHandbookFile("decisions/notes.md")).toBe(false);
  });
});
