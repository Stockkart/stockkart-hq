import { describe, expect, it } from "vitest";

import { type IssueType, type StatusCategory } from "@/lib/issues/constants";
import { extractPlainText } from "@/lib/rich-text";

import { buildReleaseNotes, notesDate, shippedIssues } from "./notes";
import { type ReleaseIssue } from "./views";

let n = 0;
function issue(
  type: IssueType,
  status: { name: string; category: StatusCategory } = { name: "Done", category: "done" },
): ReleaseIssue {
  n += 1;
  return {
    id: `i${n}`,
    key: `STK-${n}`,
    number: n,
    title: `${type} ${n}`,
    type,
    storyPoints: null,
    status: { id: `s-${status.name}`, ...status },
  };
}

/** The notes as "heading: lines" blocks, for readable expectations. */
function sections(text: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  let current = "";
  for (const line of text.split("\n")) {
    if (
      [
        "Version",
        "Date",
        "Features",
        "Fixes",
        "Tech debt & other",
        "Breaking changes",
        "Migration steps",
      ].includes(line)
    ) {
      current = line;
      result[current] = [];
    } else {
      result[current]?.push(line);
    }
  }
  return result;
}

describe("buildReleaseNotes (REL-2)", () => {
  it("lists done issues by type section, by number, Won't Do and open issues left out", () => {
    n = 0;
    const issues = [
      issue("bug"), // STK-1
      issue("story"), // STK-2
      issue("epic"), // STK-3
      issue("task"), // STK-4
      issue("spike"), // STK-5
      issue("tech_debt"), // STK-6
      issue("subtask"), // STK-7
      issue("bug", { name: "Won't Do", category: "done" }), // STK-8
      issue("story", { name: "In Progress", category: "in_progress" }), // STK-9
      issue("bug", { name: "Released", category: "done" }), // STK-10: another done status
    ];
    const doc = buildReleaseNotes({
      name: "api-v1.4",
      releaseDate: "2026-06-30",
      releasedAt: null,
      issues: [...issues].reverse(),
    });
    expect(sections(extractPlainText(doc))).toEqual({
      Version: ["api-v1.4"],
      Date: ["2026-06-30"],
      Features: ["STK-2 story 2", "STK-3 epic 3"],
      Fixes: ["STK-1 bug 1", "STK-10 bug 10"],
      "Tech debt & other": [
        "STK-4 task 4",
        "STK-5 spike 5",
        "STK-6 tech_debt 6",
        "STK-7 subtask 7",
      ],
      "Breaking changes": [],
      "Migration steps": [],
    });
  });

  it("says None for an empty section and leaves the human sections empty", () => {
    const doc = buildReleaseNotes({ name: "v2", releaseDate: null, releasedAt: null, issues: [] });
    const text = sections(extractPlainText(doc));
    expect(text.Features).toEqual(["None."]);
    expect(text.Fixes).toEqual(["None."]);
    expect(text.Date).toEqual(["Not set"]);
    // An empty bullet and an unchecked task item, ready to be filled in.
    const types = (doc.content ?? []).map((node) => node.type);
    expect(types.at(-3)).toBe("bulletList");
    expect(types.at(-1)).toBe("taskList");
  });

  it("is deterministic (the generator compares it with the stored doc)", () => {
    n = 0;
    const issues = [issue("bug"), issue("story")];
    const input = { name: "v", releaseDate: "2026-01-01", releasedAt: null, issues };
    expect(buildReleaseNotes(input)).toEqual(buildReleaseNotes({ ...input, issues: [...issues] }));
  });

  it("dates released notes by the release day, else the target date", () => {
    expect(
      notesDate({ releaseDate: "2026-06-30", releasedAt: new Date("2026-07-02T10:00:00Z") }),
    ).toBe("2026-07-02");
    expect(notesDate({ releaseDate: "2026-06-30", releasedAt: null })).toBe("2026-06-30");
  });

  it("ships only done-category issues other than Won't Do", () => {
    n = 0;
    const done = issue("bug");
    const wontDo = issue("bug", { name: "Won't Do", category: "done" });
    const todo = issue("bug", { name: "Todo", category: "todo" });
    expect(shippedIssues([done, wontDo, todo])).toEqual([done]);
  });
});
