import { describe, expect, it } from "vitest";

import { type StatusOption } from "@/lib/issues/views";

import { boardLayout } from "./board-view";

const statuses: StatusOption[] = [
  { id: "triage", name: "Triage", category: "todo" },
  { id: "todo", name: "Todo", category: "todo" },
  { id: "done", name: "Done", category: "done" },
];
const [triage, todo, done] = statuses as [StatusOption, StatusOption, StatusOption];
const issues = [
  { id: "1", type: "bug" as const, status: triage },
  { id: "2", type: "task" as const, status: todo },
  { id: "3", type: "epic" as const, status: todo },
  { id: "4", type: "bug" as const, status: done },
];

describe("boardLayout (BRD-6)", () => {
  it("shows every column and card without a view", () => {
    const layout = boardLayout(issues, statuses, { types: [], hidden: [] });
    expect(layout.columns.map((s) => s.id)).toEqual(["triage", "todo", "done"]);
    expect(layout.typed).toHaveLength(4);
    expect(layout.hiddenCount).toBe(0);
  });

  it("keeps only the picked types", () => {
    const layout = boardLayout(issues, statuses, { types: ["bug", "task"], hidden: [] });
    expect(layout.typed.map((issue) => issue.id)).toEqual(["1", "2", "4"]);
  });

  it("drops hidden columns and counts their (type-filtered) cards", () => {
    const layout = boardLayout(issues, statuses, { types: ["bug"], hidden: ["triage", "done"] });
    expect(layout.columns.map((s) => s.id)).toEqual(["todo"]);
    expect(layout.hiddenCount).toBe(2);
    const all = boardLayout(issues, statuses, { types: [], hidden: ["todo"] });
    expect(all.hiddenCount).toBe(2);
  });
});
