import { describe, expect, it } from "vitest";

import { IMPORT_CELL_MAX } from "./constants";
import { mappedFields, normaliseHeader, payloadRows, suggestMapping } from "./fields";

describe("import column mapping (IMP-4)", () => {
  it("matches headers case-insensitively, with spaces or dashes for underscores", () => {
    expect(normaliseHeader("  Due Date ")).toBe("due_date");
    expect(normaliseHeader("DUE-DATE")).toBe("due_date");
    expect(
      suggestMapping([
        "TITLE",
        "Type",
        "PRIORITY",
        "Status",
        "Assignee",
        "Labels",
        "Points",
        "Due Date",
        "Description",
      ]),
    ).toEqual({
      title: 0,
      type: 1,
      priority: 2,
      status: 3,
      assignee: 4,
      labels: 5,
      points: 6,
      due_date: 7,
      description: 8,
    });
  });

  it("knows common aliases and leaves unknown columns unmapped", () => {
    expect(suggestMapping(["Summary", "Story Points", "Tags", "Notes"])).toEqual({
      title: 0,
      points: 1,
      labels: 2,
    });
  });

  it("maps each column to one field only (the first match wins)", () => {
    expect(suggestMapping(["title", "Title", "points", "story_points"])).toEqual({
      title: 0,
      points: 2,
    });
  });

  it("sends the mapped cells per row in field order, filling missing cells", () => {
    const mapping = { description: 0, title: 2 };
    expect(mappedFields(mapping)).toEqual(["title", "description"]);
    expect(payloadRows([["text", "ignored", "A"], ["only description"]], mapping)).toEqual([
      ["A", "text"],
      ["", "only description"],
    ]);
  });

  it("cuts cells to one more than the longest field allows", () => {
    const [row] = payloadRows([["x".repeat(IMPORT_CELL_MAX + 500)]], { title: 0 });
    expect(row?.[0]).toHaveLength(IMPORT_CELL_MAX);
  });
});
