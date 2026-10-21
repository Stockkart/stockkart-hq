// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SORT, EMPTY_FILTERS } from "@/lib/issues/filters";
import { type PlanningIssue, type StatusOption } from "@/lib/issues/views";

const bulkActions = vi.hoisted(() => ({ bulkEditIssuesAction: vi.fn() }));
vi.mock("@/server/actions/bulk", () => bulkActions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { IssueList } = await import("@/features/issue/issue-list");
const { applyBulkChange } = await import("./apply");
const { toggleSelection } = await import("./use-selection");

const statuses: StatusOption[] = [
  { id: "s-todo", name: "Todo", category: "todo" },
  { id: "s-done", name: "Done", category: "done" },
];
const labels = [
  { id: "l-api", name: "api", color: null },
  { id: "l-ui", name: "ui", color: "#3b82f6" },
];
const users = [{ id: "u-ada", name: "Ada Lovelace" }];
const options = { statuses, users, labels, sprints: [] };

function issue(n: number, overrides: Partial<PlanningIssue> = {}): PlanningIssue {
  return {
    id: `i${n}`,
    key: `STK-${n}`,
    number: n,
    title: `Issue ${n}`,
    type: "task",
    priority: 2,
    status: { id: "s-todo", name: "Todo", category: "todo" },
    assignee: null,
    component: null,
    epic: null,
    storyPoints: null,
    labels: [],
    sprintId: null,
    rank: `a${n}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    resolvedAt: null,
    ...overrides,
  };
}

describe("selection (ISS-12)", () => {
  const visible = ["a", "b", "c", "d", "e"];
  const empty = { ids: new Set<string>(), anchor: null };

  it("toggles one row and remembers it as the range anchor", () => {
    const one = toggleSelection(empty, visible, "b", false);
    expect([...one.ids]).toEqual(["b"]);
    expect(one.anchor).toBe("b");
    expect([...toggleSelection(one, visible, "b", false).ids]).toEqual([]);
  });

  it("shift-click selects (or clears) the range from the anchor, either direction", () => {
    const anchored = toggleSelection(empty, visible, "d", false);
    const range = toggleSelection(anchored, visible, "b", true);
    expect([...range.ids].sort()).toEqual(["b", "c", "d"]);
    const cleared = toggleSelection(range, visible, "c", true);
    expect([...cleared.ids].sort()).toEqual(["b"]);
  });

  it("treats shift-click without a visible anchor as a plain toggle", () => {
    const anchored = toggleSelection(empty, ["x", ...visible], "x", false);
    expect([...toggleSelection(anchored, visible, "c", true).ids].sort()).toEqual(["c", "x"]);
  });
});

describe("applyBulkChange (optimistic ISS-12)", () => {
  const list = [issue(1, { labels: [labels[1] ?? { id: "", name: "", color: null }] }), issue(2)];
  const both = new Set(["i1", "i2"]);

  it("applies status, priority, assignee and labels like the server", () => {
    expect(
      applyBulkChange(list, both, { kind: "status", statusId: "s-done" }, options).map(
        (i) => i.status.name,
      ),
    ).toEqual(["Done", "Done"]);
    expect(
      applyBulkChange(list, new Set(["i2"]), { kind: "priority", priority: 0 }, options).map(
        (i) => i.priority,
      ),
    ).toEqual([2, 0]);
    expect(
      applyBulkChange(list, both, { kind: "assignee", assigneeId: "u-ada" }, options)[0]?.assignee,
    ).toEqual({ id: "u-ada", name: "Ada Lovelace" });
    const added = applyBulkChange(list, both, { kind: "addLabels", labelIds: ["l-api"] }, options);
    expect(added.map((i) => i.labels.map((l) => l.name))).toEqual([["api", "ui"], ["api"]]);
    const removed = applyBulkChange(
      added,
      both,
      { kind: "removeLabels", labelIds: ["l-ui"] },
      options,
    );
    expect(removed.map((i) => i.labels.map((l) => l.name))).toEqual([["api"], ["api"]]);
  });

  it("removes deleted issues and leaves unselected ones alone", () => {
    expect(applyBulkChange(list, new Set(["i1"]), { kind: "delete" }, options)).toEqual([list[1]]);
  });
});

describe("IssueList bulk edit (ISS-12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const issues = [issue(1), issue(2), issue(3)];
  const renderList = () =>
    render(
      <IssueList
        issues={issues}
        projectKey="STK"
        filters={EMPTY_FILTERS}
        sort={DEFAULT_SORT}
        bulkOptions={options}
      />,
    );

  it("selects all shown issues and sets their status, optimistically", async () => {
    let finish: (value: unknown) => void = () => {};
    bulkActions.bulkEditIssuesAction.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole("checkbox", { name: "Select all shown issues" }));
    const bar = screen.getByRole("group", { name: "Bulk edit 3 issues" });
    await user.click(within(bar).getByRole("combobox", { name: "Set status of 3 issues" }));
    await user.click(screen.getByRole("option", { name: "Done" }));
    expect(bulkActions.bulkEditIssuesAction).toHaveBeenCalledWith({
      projectKey: "STK",
      issueIds: ["i1", "i2", "i3"],
      change: { kind: "status", statusId: "s-done" },
    });
    // Shown before the server answers.
    expect(screen.getAllByText("Done").length).toBeGreaterThanOrEqual(3);
    finish({ ok: true, data: { changed: 3 } });
  });

  it("rolls back when the bulk edit fails", async () => {
    bulkActions.bulkEditIssuesAction.mockResolvedValue({ ok: false, error: "Status not found" });
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole("checkbox", { name: "Select STK-2" }));
    const bar = screen.getByRole("group", { name: "Bulk edit 1 issue" });
    await user.click(within(bar).getByRole("combobox", { name: "Set status of 1 issue" }));
    await user.click(screen.getByRole("option", { name: "Done" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Status not found"));
    await waitFor(() => expect(screen.queryAllByText("Done")).toHaveLength(0));
  });

  it("toggles the focused row with x (J/K focus), and clears the selection", async () => {
    const user = userEvent.setup();
    renderList();
    await user.keyboard("j");
    await user.keyboard("x");
    expect(screen.getByRole("checkbox", { name: "Select STK-1" })).toBeChecked();
    await user.keyboard("jx");
    expect(screen.getByRole("group", { name: "Bulk edit 2 issues" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("group", { name: /Bulk edit/ })).not.toBeInTheDocument();
  });
});
