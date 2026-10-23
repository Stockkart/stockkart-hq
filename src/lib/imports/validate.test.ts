import { describe, expect, it } from "vitest";

import { TITLE_MAX } from "@/lib/issues/schemas";

import { IMPORT_DESCRIPTION_MAX, IMPORT_QUOTE_MAX } from "./constants";
import { type ImportField } from "./fields";
import { isIsoDate, quote, validateImportRows } from "./validate";

const lookups = {
  statuses: [
    { id: "s-backlog", name: "Backlog" },
    { id: "s-done", name: "Done" },
  ],
  users: [
    { id: "u-ada", name: "Ada Lovelace", email: "ada@example.test" },
    { id: "u-alan", name: "Alan Turing", email: "alan@example.test" },
    { id: "u-alan2", name: "Alan Turing", email: "alan.t@example.test" },
  ],
};

const ALL: ImportField[] = [
  "title",
  "type",
  "priority",
  "status",
  "assignee",
  "labels",
  "points",
  "due_date",
  "description",
];

/** One row with every field, `overrides` by field name. */
function row(overrides: Partial<Record<ImportField, string>> = {}): string[] {
  const base: Record<ImportField, string> = {
    title: "Fix the OOM",
    type: "bug",
    priority: "P1",
    status: "done",
    assignee: "ADA@example.test",
    labels: "Backend; ocr ;backend",
    points: "3",
    due_date: "2026-06-30",
    description: "Line one\nLine two",
  };
  return ALL.map((field) => overrides[field] ?? base[field]);
}

const one = (overrides: Partial<Record<ImportField, string>>) => {
  const [result] = validateImportRows(ALL, [row(overrides)], lookups);
  if (!result) throw new Error("no result");
  return result;
};
const messages = (overrides: Partial<Record<ImportField, string>>) =>
  one(overrides).errors.map((error) => `${error.field}: ${error.message}`);

describe("validateImportRows (IMP-4)", () => {
  it("turns a full valid row into issue values (names and emails case-insensitively)", () => {
    expect(one({})).toEqual({
      row: 2,
      errors: [],
      values: {
        title: "Fix the OOM",
        type: "bug",
        priority: 1,
        statusId: "s-done",
        assigneeId: "u-ada",
        labels: ["backend", "ocr"],
        storyPoints: 3,
        dueDate: "2026-06-30",
        description: "Line one\nLine two",
      },
    });
  });

  it("uses defaults for empty optional cells and for unmapped fields", () => {
    const [result] = validateImportRows(["title"], [["  Just   a title "]], lookups);
    expect(result?.values).toEqual({
      title: "Just a title",
      type: "task",
      priority: 2,
      statusId: null,
      assigneeId: undefined,
      labels: [],
      storyPoints: null,
      dueDate: null,
      description: null,
    });
  });

  it("numbers rows as a spreadsheet does (header = row 1)", () => {
    const results = validateImportRows(["title"], [["a"], ["b"], ["c"]], lookups);
    expect(results.map((result) => result.row)).toEqual([2, 3, 4]);
  });

  it("requires a title of at most 255 characters", () => {
    expect(messages({ title: "   " })).toEqual(["title: Title is required"]);
    expect(messages({ title: "x".repeat(TITLE_MAX + 1) })).toEqual([
      `title: Title is longer than ${TITLE_MAX} characters`,
    ]);
    expect(one({ title: "x".repeat(TITLE_MAX) }).errors).toEqual([]);
  });

  it("accepts type names and labels in any case, refuses unknown ones and subtasks", () => {
    expect(one({ type: "Tech-debt" }).values?.type).toBe("tech_debt");
    expect(one({ type: "tech debt" }).values?.type).toBe("tech_debt");
    expect(one({ type: "STORY" }).values?.type).toBe("story");
    expect(messages({ type: "feature" })).toEqual(["type: Unknown type “feature”"]);
    expect(messages({ type: "subtask" })).toEqual([
      "type: Subtasks need a parent; import them as tasks",
    ]);
  });

  it.each([
    ["P0", 0],
    ["p3", 3],
    ["2", 2],
    [" P1 ", 1],
  ])("reads priority %j as %d", (value, expected) => {
    expect(one({ priority: value }).values?.priority).toBe(expected);
  });

  it.each(["P4", "4", "-1", "high", "1.0"])("refuses priority %j", (value) => {
    expect(one({ priority: value }).errors[0]?.field).toBe("priority");
  });

  it("finds the status by name, refusing unknown ones", () => {
    expect(one({ status: "BACKLOG" }).values?.statusId).toBe("s-backlog");
    expect(messages({ status: "Shipped" })).toEqual(["status: Unknown status “Shipped”"]);
  });

  it("finds the assignee by email or name; an ambiguous name needs the email", () => {
    expect(one({ assignee: "ada lovelace" }).values?.assigneeId).toBe("u-ada");
    expect(one({ assignee: "alan.t@example.test" }).values?.assigneeId).toBe("u-alan2");
    expect(messages({ assignee: "Alan Turing" })).toEqual([
      "assignee: “Alan Turing” matches several users; use the email",
    ]);
    expect(messages({ assignee: "grace@example.test" })).toEqual([
      "assignee: Unknown assignee “grace@example.test”",
    ]);
  });

  it("splits labels on semicolons, normalises them and refuses bad names", () => {
    expect(one({ labels: "Needs Review;;  " }).values?.labels).toEqual(["needs-review"]);
    expect(one({ labels: "ok;!bad" }).errors[0]?.message).toMatch(/^Label “!bad”: /);
  });

  it.each(["-1", "1000", "2.5", "three", "1e2"])("refuses points %j", (value) => {
    expect(one({ points: value }).errors[0]?.field).toBe("points");
  });

  it("accepts points 0 and 999", () => {
    expect(one({ points: "0" }).values?.storyPoints).toBe(0);
    expect(one({ points: "999" }).values?.storyPoints).toBe(999);
  });

  it.each(["2026-02-30", "2026-13-01", "30/06/2026", "2026-6-1", "tomorrow"])(
    "refuses due date %j",
    (value) => {
      expect(one({ due_date: value }).errors[0]?.field).toBe("due_date");
    },
  );

  it("limits the description", () => {
    expect(messages({ description: "x".repeat(IMPORT_DESCRIPTION_MAX + 1) })).toEqual([
      `description: Description is longer than ${IMPORT_DESCRIPTION_MAX} characters`,
    ]);
  });

  it("reports every problem of a row, one per cell, and no values", () => {
    const result = one({ type: "x", priority: "x", status: "x", points: "x", due_date: "x" });
    expect(result.values).toBeNull();
    expect(result.errors.map((error) => error.field)).toEqual([
      "type",
      "priority",
      "status",
      "points",
      "due_date",
    ]);
  });

  it("quotes at most a short part of a cell in messages (nothing long is stored)", () => {
    const long = "y".repeat(500);
    const [error] = one({ status: long }).errors;
    expect(error?.message.length).toBeLessThan(IMPORT_QUOTE_MAX + 40);
    expect(quote(`  a \n b  `)).toBe("“a b”");
  });

  it("checks real calendar dates", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
  });
});
