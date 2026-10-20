import { describe, expect, it } from "vitest";

import { extractPlainText, rt } from "@/lib/rich-text";

import { adrTitle, formatAdrNumber, parseAdrStatus, splitAdrTitle } from "./adr";
import { buildTree, descendantIds, siblingsOf } from "./tree";

describe("ADR helpers (ADR-1, ADR-2)", () => {
  it("zero-pads numbers and builds titles", () => {
    expect(formatAdrNumber(11)).toBe("0011");
    expect(adrTitle(7, "Use queues")).toBe("0007. Use queues");
    expect(splitAdrTitle("0011. Delete things")).toEqual({ number: 11, title: "Delete things" });
    expect(splitAdrTitle("No number")).toBeNull();
  });

  it.each([
    ["Accepted.", "accepted", null],
    ["`Accepted`", "accepted", null],
    ["Accepted (recorded retrospectively).\nRecorded against x", "accepted_retrospective", null],
    ["Superseded by [0010](0010-something.md).", "superseded", 10],
    ["Superseded by 0003", "superseded", 3],
    ["Superseded by ADR-0004", "superseded", 4],
    ["Deprecated", "deprecated", null],
    ["Proposed", "proposed", null],
  ])("parses %j", (text, status, supersededBy) => {
    expect(parseAdrStatus(text)).toEqual({ status, supersededBy });
  });

  it("returns null for unknown status text", () => {
    expect(parseAdrStatus("Maybe later")).toBeNull();
  });
});

describe("tree helpers (DOC-2)", () => {
  const docs = [
    { id: "a", parentId: null, position: "a1" },
    { id: "b", parentId: "a", position: "a0" },
    { id: "c", parentId: "b", position: "a0" },
    { id: "d", parentId: null, position: "a0" },
    { id: "orphan", parentId: "gone", position: "a2" },
    { id: "e", parentId: "a", position: "a0" },
  ];

  it("nests and orders siblings by position then id; orphans go to the top", () => {
    const tree = buildTree(docs);
    expect(tree.map((node) => node.id)).toEqual(["d", "a", "orphan"]);
    expect(tree[1]?.children.map((node) => node.id)).toEqual(["b", "e"]);
  });

  it("finds descendants", () => {
    expect([...descendantIds(docs, "a")].sort()).toEqual(["b", "c", "e"]);
    expect(descendantIds(docs, "c").size).toBe(0);
  });

  it("lists siblings without the moving doc", () => {
    expect(siblingsOf(docs, "a", "b").map((doc) => doc.id)).toEqual(["e"]);
    expect(siblingsOf(docs, null).map((doc) => doc.id)).toEqual(["d", "a", "orphan"]);
  });
});

describe("extractPlainText with doc blocks", () => {
  const doc = rt.doc(
    rt.paragraph("Intro"),
    { type: "mermaid", attrs: { source: "sequenceDiagram\n  A->>B: outbox STK-9" } },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [rt.paragraph("Name")] },
            { type: "tableCell", content: [rt.paragraph("Value")] },
          ],
        },
      ],
    },
    { type: "callout", attrs: { tone: "warning" }, content: [rt.paragraph("Careful")] },
  );

  it("includes mermaid source, table cells and callouts (searchable)", () => {
    const text = extractPlainText(doc);
    expect(text).toContain("sequenceDiagram\n  A->>B: outbox STK-9");
    expect(text.split("\n")).toEqual(expect.arrayContaining(["Intro", "Name", "Value", "Careful"]));
  });

  it("treats mermaid source as code when skipping code (no mentions from diagrams)", () => {
    expect(extractPlainText(doc, { skipCode: true })).not.toContain("STK-9");
  });
});
