// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type PlanningIssue, type StatusOption } from "@/lib/issues/views";

const issueActions = vi.hoisted(() => ({ updateIssueFieldAction: vi.fn() }));
vi.mock("@/server/actions/issues", () => issueActions);
const planningActions = vi.hoisted(() => ({ moveIssueAction: vi.fn() }));
vi.mock("@/server/actions/planning", () => planningActions);
const sprintActions = vi.hoisted(() => ({
  moveIssueToSprintAction: vi.fn(),
  createSprintAction: vi.fn(),
  updateSprintAction: vi.fn(),
  deleteSprintAction: vi.fn(),
  startSprintAction: vi.fn(),
  completeSprintAction: vi.fn(),
}));
vi.mock("@/server/actions/sprints", () => sprintActions);
const bulkActions = vi.hoisted(() => ({ bulkEditIssuesAction: vi.fn() }));
vi.mock("@/server/actions/bulk", () => bulkActions);
const settingsActions = vi.hoisted(() => ({ saveViewDefaultsAction: vi.fn() }));
vi.mock("@/server/actions/settings", () => settingsActions);
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/STK/board",
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { Backlog } = await import("./backlog");
const { Board } = await import("./board");
const { BoardSprintPicker, pickerValue, selectionOf } = await import("./board-scope");

const statuses: StatusOption[] = [
  { id: "s-todo", name: "Todo", category: "todo" },
  { id: "s-prog", name: "In Progress", category: "in_progress" },
  { id: "s-done", name: "Done", category: "done" },
];
const ada = { id: "u-ada", name: "Ada Lovelace" };
/** BRD-6: every type, no hidden column (the defaults of a fresh project). */
const viewProps = {
  selection: { scope: "sprint" as const, sprintId: null },
  view: { types: [], hidden: [] },
  defaults: { types: [], hidden: [] },
};

function issue(n: number, overrides: Partial<PlanningIssue> = {}): PlanningIssue {
  return {
    id: `i${n}`,
    key: `STK-${n}`,
    number: n,
    title: `Issue ${n}`,
    type: "task",
    priority: 2,
    status: statuses[0] ?? { id: "s-todo", name: "Todo", category: "todo" },
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

const rowTitles = () =>
  screen
    .getAllByRole("link", { name: /^STK-\d+:/ })
    .map((link) => link.textContent?.replace(/^STK-\d+:\s*/, ""));

const backlogProps = {
  sprints: [],
  projectKey: "STK",
  sprintLengthDays: 14,
  sprintDefaults: { name: "Sprint 1", startDate: "2026-06-01", endDate: "2026-06-14" },
  users: [ada],
  filtered: false,
  bulkOptions: { statuses, users: [ada], labels: [], sprints: [] },
};

describe("Backlog (BLG-1/2/4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planningActions.moveIssueAction.mockResolvedValue({ ok: true, data: { rank: "x" } });
    issueActions.updateIssueFieldAction.mockResolvedValue({ ok: true, data: {} });
  });

  const issues = [
    issue(1, { storyPoints: 3, assignee: ada }),
    issue(2, { storyPoints: 5 }),
    issue(3, { assignee: ada, storyPoints: 2 }),
  ];

  it("moves a row with the keyboard menu, sending its new predecessor", async () => {
    const user = userEvent.setup();
    render(<Backlog {...backlogProps} issues={issues} group="none" />);
    await user.click(screen.getByRole("button", { name: "Actions for STK-3" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move up" }));
    expect(planningActions.moveIssueAction).toHaveBeenCalledWith({
      issueId: "i3",
      afterIssueId: "i1",
    });
  });

  it("rolls the order back when the move fails", async () => {
    planningActions.moveIssueAction.mockResolvedValue({ ok: false, error: "Issue not found" });
    const user = userEvent.setup();
    render(<Backlog {...backlogProps} issues={issues} group="none" />);
    await user.click(screen.getByRole("button", { name: "Actions for STK-3" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move to top" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Issue not found"));
    // The transition ends just after the toast; then the server order shows again.
    await waitFor(() => expect(rowTitles()).toEqual(["Issue 1", "Issue 2", "Issue 3"]));
  });

  it("groups by assignee with point totals, and collapses a group", async () => {
    const user = userEvent.setup();
    render(<Backlog {...backlogProps} issues={issues} group="assignee" />);
    const adaGroup = screen.getByRole("region", { name: "Ada Lovelace" });
    expect(within(adaGroup).getByText("5 pts")).toBeInTheDocument();
    const unassigned = screen.getByRole("region", { name: "Unassigned" });
    expect(within(unassigned).getByText("5 pts")).toBeInTheDocument();
    const toggle = within(adaGroup).getByRole("button", { name: /Ada Lovelace/ });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(adaGroup).getByRole("list", { hidden: true })).not.toBeVisible();
    // Menus only offer moves within the section.
    await user.click(within(unassigned).getByRole("button", { name: "Actions for STK-2" }));
    expect(await screen.findByRole("menuitem", { name: "Move up" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("edits priority inline through updateIssueField", async () => {
    const user = userEvent.setup();
    render(<Backlog {...backlogProps} issues={issues} group="none" />);
    await user.click(screen.getByRole("combobox", { name: "Priority of STK-2" }));
    await user.click(screen.getByRole("option", { name: /^P0/ }));
    await waitFor(() =>
      expect(issueActions.updateIssueFieldAction).toHaveBeenCalledWith({
        issueId: "i2",
        field: "priority",
        value: 0,
      }),
    );
  });
});

describe("Backlog bulk edit (ISS-12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const issues = [issue(1), issue(2), issue(3), issue(4)];
  const checkbox = (key: string) => screen.getByRole("checkbox", { name: `Select ${key}` });

  it("selects a range with shift-click and sets the priority of all of them", async () => {
    bulkActions.bulkEditIssuesAction.mockResolvedValue({ ok: true, data: { changed: 3 } });
    const user = userEvent.setup();
    render(<Backlog {...backlogProps} issues={issues} group="none" />);
    await user.click(checkbox("STK-1"));
    await user.keyboard("{Shift>}");
    await user.click(checkbox("STK-3"));
    await user.keyboard("{/Shift}");
    const bar = screen.getByRole("group", { name: "Bulk edit 3 issues" });
    expect(checkbox("STK-4")).not.toBeChecked();
    await user.click(within(bar).getByRole("combobox", { name: "Set priority of 3 issues" }));
    await user.click(screen.getByRole("option", { name: /^P0/ }));
    await waitFor(() =>
      expect(bulkActions.bulkEditIssuesAction).toHaveBeenCalledWith({
        projectKey: "STK",
        issueIds: ["i1", "i2", "i3"],
        change: { kind: "priority", priority: 0 },
      }),
    );
  });

  it("toggles the focused row with x, and rolls a failed delete back", async () => {
    bulkActions.bulkEditIssuesAction.mockResolvedValue({ ok: false, error: "Nope" });
    const user = userEvent.setup();
    render(<Backlog {...backlogProps} issues={issues} group="none" />);
    screen.getByRole("link", { name: /^STK-2:/ }).focus();
    await user.keyboard("x");
    expect(checkbox("STK-2")).toBeChecked();
    const bar = screen.getByRole("group", { name: "Bulk edit 1 issue" });
    await user.click(within(bar).getByRole("button", { name: "Delete" }));
    await user.click(await screen.findByRole("button", { name: "Delete 1 issue" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nope"));
    await waitFor(() => expect(rowTitles()).toEqual(["Issue 1", "Issue 2", "Issue 3", "Issue 4"]));
  });
});

describe("Backlog sprint sections (BLG-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sprintActions.moveIssueToSprintAction.mockResolvedValue({
      ok: true,
      data: { rank: "x", sprintId: "sp-8" },
    });
    sprintActions.startSprintAction.mockResolvedValue({
      ok: true,
      data: { committedPoints: 3, issueIds: ["i2"] },
    });
  });

  const tally = (count: number, points: number) => ({ count, points });
  const sprints = [
    {
      id: "sp-7",
      name: "Sprint 7",
      goal: "Make 2 containers safe",
      startDate: "2026-06-02",
      endDate: "2026-06-15",
      state: "active" as const,
      closedAt: null,
      open: tally(1, 5),
      done: tally(1, 2),
      wontDo: tally(0, 0),
      retroDocId: null,
    },
    {
      id: "sp-8",
      name: "Sprint 8",
      goal: null,
      startDate: "2026-06-16",
      endDate: "2026-06-29",
      state: "planned" as const,
      closedAt: null,
      open: tally(0, 0),
      done: tally(0, 0),
      wontDo: tally(0, 0),
      retroDocId: null,
    },
  ];
  const done = { id: "s-done", name: "Done", category: "done" as const };
  const issues = [
    issue(1, { sprintId: "sp-7", storyPoints: 5 }),
    issue(4, { sprintId: "sp-7", storyPoints: 2, status: done }),
    issue(2, { storyPoints: 3 }),
    issue(3, { storyPoints: 1 }),
  ];

  it("shows a section per open sprint with dates, goal and points", () => {
    render(<Backlog {...backlogProps} sprints={sprints} issues={issues} group="none" />);
    const active = screen.getByRole("region", { name: "Sprint 7" });
    expect(active).toHaveTextContent("Jun 2 – Jun 15");
    expect(active).toHaveTextContent("Make 2 containers safe");
    // The active sprint shows its done issues too.
    expect(within(active).getByText("7 pts")).toBeInTheDocument();
    expect(within(active).getByRole("button", { name: "Complete Sprint 7" })).toBeInTheDocument();
    const planned = screen.getByRole("region", { name: "Sprint 8" });
    expect(within(planned).getByText(/Drag issues here/)).toBeInTheDocument();
    expect(within(planned).getByRole("button", { name: "Start Sprint 8" })).toBeInTheDocument();
    const backlog = screen.getByRole("region", { name: "Backlog" });
    expect(within(backlog).getByText("4 pts")).toBeInTheDocument();
  });

  it("moves an issue into a sprint with the Move to sprint… menu", async () => {
    const user = userEvent.setup();
    render(<Backlog {...backlogProps} sprints={sprints} issues={issues} group="none" />);
    await user.click(screen.getByRole("button", { name: "Actions for STK-2" }));
    await user.click(await screen.findByRole("menuitem", { name: "Sprint 8" }));
    expect(sprintActions.moveIssueToSprintAction).toHaveBeenCalledWith({
      issueId: "i2",
      sprintId: "sp-8",
    });
    // Optimistic: the row shows in the sprint section at once, and keeps keyboard focus.
    const planned = screen.getByRole("region", { name: "Sprint 8" });
    expect(within(planned).getByRole("link", { name: /STK-2/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Actions for STK-2" })).toHaveFocus(),
    );
  });

  it("moves a sprint issue back to the backlog", async () => {
    const user = userEvent.setup();
    render(<Backlog {...backlogProps} sprints={sprints} issues={issues} group="none" />);
    await user.click(screen.getByRole("button", { name: "Actions for STK-1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Backlog" }));
    expect(sprintActions.moveIssueToSprintAction).toHaveBeenCalledWith({
      issueId: "i1",
      sprintId: null,
    });
  });

  it("starts a planned sprint from its section, keyboard only", async () => {
    const user = userEvent.setup();
    render(
      <Backlog
        {...backlogProps}
        sprints={sprints.slice(1).map((planned) => ({ ...planned, open: tally(1, 3) }))}
        issues={[issue(2, { sprintId: "sp-8", storyPoints: 3 })]}
        group="none"
      />,
    );
    screen.getByRole("button", { name: "Start Sprint 8" }).focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "Start Sprint 8?" });
    expect(dialog).toHaveTextContent("3 pts");
    await waitFor(() => expect(screen.getByRole("button", { name: "Start sprint" })).toHaveFocus());
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(sprintActions.startSprintAction).toHaveBeenCalledWith({ sprintId: "sp-8" }),
    );
    expect(toast.success).toHaveBeenCalledWith("Sprint 8 started");
  });
});

describe("Board (BRD-1/2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issueActions.updateIssueFieldAction.mockResolvedValue({ ok: true, data: {} });
  });

  const issues = [
    issue(7, {
      priority: 0,
      assignee: ada,
      storyPoints: 5,
      labels: [{ id: "l", name: "ocr", color: null }],
    }),
    issue(8),
  ];

  it("shows the card fields", () => {
    render(<Board issues={issues} statuses={statuses} projectKey="STK" {...viewProps} />);
    const card = screen.getByRole("link", { name: /STK-7/ }).closest("li");
    const scope = within(card ?? document.body);
    expect(scope.getByText("STK-7")).toBeInTheDocument();
    expect(scope.getByText("Task")).toBeInTheDocument();
    expect(scope.getByTitle("P0 Critical")).toBeInTheDocument();
    expect(scope.getByText("Assigned to Ada Lovelace")).toBeInTheDocument();
    expect(scope.getByText("ocr")).toBeInTheDocument();
    expect(scope.getByText("5")).toBeInTheDocument();
  });

  it("moves a card with the Move to… menu (keyboard alternative)", async () => {
    const user = userEvent.setup();
    render(<Board issues={issues} statuses={statuses} projectKey="STK" {...viewProps} />);
    await user.click(screen.getByRole("button", { name: "Move STK-8 to…" }));
    await user.click(await screen.findByRole("menuitem", { name: "In Progress" }));
    await waitFor(() =>
      expect(issueActions.updateIssueFieldAction).toHaveBeenCalledWith({
        issueId: "i8",
        field: "status",
        value: "s-prog",
      }),
    );
    // The card remounts in another column (and back: this test never sends new server
    // data, so the optimistic move ends) and keeps keyboard focus throughout.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Move STK-8 to…" })).toHaveFocus(),
    );
  });

  it("rolls a failed move back to the original column", async () => {
    issueActions.updateIssueFieldAction.mockResolvedValue({ ok: false, error: "Status not found" });
    const user = userEvent.setup();
    render(<Board issues={issues} statuses={statuses} projectKey="STK" {...viewProps} />);
    await user.click(screen.getByRole("button", { name: "Move STK-8 to…" }));
    await user.click(await screen.findByRole("menuitem", { name: "Done" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Status not found"));
    await waitFor(() => {
      const todo = screen.getByRole("region", { name: /Todo/ });
      expect(within(todo).getByRole("link", { name: /STK-8/ })).toBeInTheDocument();
    });
  });
});

describe("Board WIP limits (BRD-5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issueActions.updateIssueFieldAction.mockResolvedValue({ ok: true, data: {} });
  });

  const inProgress: StatusOption = {
    id: "s-prog",
    name: "In Progress",
    category: "in_progress",
    wipLimit: 1,
  };
  const limited: StatusOption[] = [
    { id: "s-todo", name: "Todo", category: "todo", wipLimit: null },
    inProgress,
    { id: "s-done", name: "Done", category: "done" },
  ];

  it("shows count / limit, and turns a column over its limit amber with a text badge", () => {
    render(
      <Board
        issues={[issue(1, { status: inProgress }), issue(2, { status: inProgress }), issue(3)]}
        statuses={limited}
        projectKey="STK"
        {...viewProps}
      />,
    );
    const column = screen.getByRole("region", { name: /In Progress/ });
    expect(within(column).getByText("2 / 1")).toBeInTheDocument();
    expect(within(column).getByText("2 issues, WIP limit 1")).toBeInTheDocument();
    expect(within(column).getByText("Over WIP limit")).toBeInTheDocument();
    expect(column.className).toMatch(/amber/);
    const todo = screen.getByRole("region", { name: /Todo/ });
    expect(within(todo).queryByText("Over WIP limit")).toBeNull();
    expect(todo.className).not.toMatch(/amber/);
  });

  it("does not flag a column at its limit", () => {
    render(
      <Board
        issues={[issue(1, { status: inProgress })]}
        statuses={limited}
        projectKey="STK"
        {...viewProps}
      />,
    );
    const column = screen.getByRole("region", { name: /In Progress/ });
    expect(within(column).getByText("1 / 1")).toBeInTheDocument();
    expect(within(column).queryByText("Over WIP limit")).toBeNull();
  });

  it("allows a move into a full column, with a warning toast", async () => {
    const user = userEvent.setup();
    render(
      <Board
        issues={[issue(1, { status: inProgress }), issue(2)]}
        statuses={limited}
        projectKey="STK"
        {...viewProps}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Move STK-2 to…" }));
    await user.click(await screen.findByRole("menuitem", { name: "In Progress" }));
    await waitFor(() =>
      expect(issueActions.updateIssueFieldAction).toHaveBeenCalledWith({
        issueId: "i2",
        field: "status",
        value: "s-prog",
      }),
    );
    expect(toast.warning).toHaveBeenCalledWith("In Progress is over its WIP limit", {
      description: "2 issues, limit 1.",
    });
  });

  it("moves into a column with room without a warning", async () => {
    const user = userEvent.setup();
    render(<Board issues={[issue(2)]} statuses={limited} projectKey="STK" {...viewProps} />);
    await user.click(screen.getByRole("button", { name: "Move STK-2 to…" }));
    await user.click(await screen.findByRole("menuitem", { name: "In Progress" }));
    await waitFor(() => expect(issueActions.updateIssueFieldAction).toHaveBeenCalled());
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

describe("Board view: types and hidden columns (BRD-6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issueActions.updateIssueFieldAction.mockResolvedValue({ ok: true, data: {} });
    settingsActions.saveViewDefaultsAction.mockResolvedValue({ ok: true, data: undefined });
  });

  const [todo, prog, done] = statuses as [StatusOption, StatusOption, StatusOption];
  const issues = [
    issue(1, { type: "bug" }),
    issue(2, { type: "task", status: prog }),
    issue(3, { type: "epic", status: done }),
  ];
  const cards = () =>
    screen.queryAllByRole("link", { name: /^STK-\d+:/ }).map((l) => l.textContent);

  it("shows only the picked types, and writes them to the URL", async () => {
    const user = userEvent.setup();
    render(
      <Board
        issues={issues}
        statuses={statuses}
        {...viewProps}
        projectKey="STK"
        view={{ types: ["bug"], hidden: [] }}
      />,
    );
    expect(cards()).toEqual(["STK-1: Issue 1"]);
    await user.click(screen.getByRole("combobox", { name: "Type: Bug" }));
    await user.click(screen.getByRole("option", { name: "Task" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(String(router.replace.mock.calls.at(-1)?.[0])).toBe("/STK/board?types=task%2Cbug");
  });

  it("hides columns, counts their cards, and Show brings them back", async () => {
    const user = userEvent.setup();
    render(
      <Board
        issues={issues}
        statuses={statuses}
        {...viewProps}
        projectKey="STK"
        view={{ types: [], hidden: [done.id] }}
      />,
    );
    // A hidden column is no region and so no drop target.
    expect(screen.queryByRole("region", { name: /Done/ })).toBeNull();
    expect(screen.getAllByRole("region")).toHaveLength(2);
    expect(screen.getByText(/1 issue in hidden columns/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(String(router.replace.mock.calls.at(-1)?.[0])).toBe("/STK/board");
  });

  it("still offers hidden statuses in Move to…, so no card gets stuck", async () => {
    const user = userEvent.setup();
    render(
      <Board
        issues={issues}
        statuses={statuses}
        {...viewProps}
        projectKey="STK"
        view={{ types: [], hidden: [done.id] }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Move STK-1 to…" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["Todo", "In Progress", "Done"]);
    await user.click(screen.getByRole("menuitem", { name: "Done" }));
    await waitFor(() =>
      expect(issueActions.updateIssueFieldAction).toHaveBeenCalledWith({
        issueId: "i1",
        field: "status",
        value: done.id,
      }),
    );
    // The card leaves the board; keyboard focus lands on the hidden-columns note's Show.
    await waitFor(() => expect(screen.getByRole("button", { name: "Show" })).toHaveFocus());
  });

  it("toggles columns in the Columns menu, keeping the last one visible", async () => {
    const user = userEvent.setup();
    render(
      <Board
        issues={issues}
        statuses={statuses}
        {...viewProps}
        projectKey="STK"
        view={{ types: [], hidden: [todo.id, prog.id] }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Columns/ }));
    const last = await screen.findByRole("menuitemcheckbox", { name: "Done" });
    expect(last).toHaveAttribute("aria-checked", "true");
    expect(last).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Todo" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(String(router.replace.mock.calls.at(-1)?.[0])).toBe(`/STK/board?hide=${prog.id}`);
  });

  it("saves a changed view as the default and resets to it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Board issues={issues} statuses={statuses} {...viewProps} projectKey="STK" />,
    );
    // At the defaults: nothing to save or reset.
    expect(screen.queryByRole("button", { name: "Save as default" })).toBeNull();
    rerender(
      <Board
        issues={issues}
        statuses={statuses}
        {...viewProps}
        selection={{ scope: "all", sprintId: null }}
        projectKey="STK"
        view={{ types: ["bug"], hidden: [done.id] }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save as default" }));
    await waitFor(() =>
      expect(settingsActions.saveViewDefaultsAction).toHaveBeenCalledWith({
        projectKey: "STK",
        board: { issueTypes: ["bug"], hiddenStatusIds: [done.id] },
      }),
    );
    // Now the default: the plain URL (scope kept) shows it.
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/STK/board?scope=all", {
        scroll: false,
      }),
    );
    router.replace.mockClear();
    await user.click(screen.getByRole("button", { name: "Reset to default" }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/STK/board?scope=all", { scroll: false }),
    );
  });

  it("counts the cards a column shows against its WIP limit (type filter applied)", () => {
    const limited = statuses.map((status) =>
      status.id === prog.id ? { ...status, wipLimit: 1 } : status,
    );
    render(
      <Board
        issues={[issue(4, { type: "bug", status: prog }), issue(5, { type: "task", status: prog })]}
        statuses={limited}
        {...viewProps}
        projectKey="STK"
        view={{ types: ["bug"], hidden: [] }}
      />,
    );
    const column = screen.getByRole("region", { name: /In Progress/ });
    expect(within(column).getByText("1 / 1")).toBeInTheDocument();
  });
});

describe("Board sprint picker (BRD-3)", () => {
  const ACTIVE = "00000000-0000-4000-8000-000000000007";
  const PLANNED = "00000000-0000-4000-8000-000000000008";
  const sprints = [
    { id: ACTIVE, name: "Sprint 7", state: "active" as const },
    { id: PLANNED, name: "Sprint 8", state: "planned" as const },
  ];

  beforeEach(() => {
    router.push.mockReset();
    router.replace.mockReset();
  });

  it("maps selections to picker values and back (the active sprint is the plain URL)", () => {
    expect(pickerValue({ scope: "sprint", sprintId: null }, ACTIVE)).toBe(ACTIVE);
    expect(pickerValue({ scope: "sprint", sprintId: null }, null)).toBe("all");
    expect(pickerValue({ scope: "sprint", sprintId: PLANNED }, ACTIVE)).toBe(PLANNED);
    expect(pickerValue({ scope: "all", sprintId: null }, ACTIVE)).toBe("all");
    expect(selectionOf(ACTIVE, ACTIVE)).toEqual({ scope: "sprint", sprintId: null });
    expect(selectionOf(PLANNED, ACTIVE)).toEqual({ scope: "sprint", sprintId: PLANNED });
    expect(selectionOf("all", ACTIVE)).toEqual({ scope: "all", sprintId: null });
    // Without an active sprint the plain URL already is every open issue.
    expect(selectionOf("all", null)).toEqual({ scope: "sprint", sprintId: null });
  });

  it("lists the open sprints and 'All open', and opens the picked one (view kept)", async () => {
    const user = userEvent.setup();
    render(
      <BoardSprintPicker
        projectKey="STK"
        selection={{ scope: "sprint", sprintId: null }}
        sprints={sprints}
        viewQuery={new URLSearchParams("types=bug")}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Sprint" });
    expect(trigger).toHaveTextContent("Sprint 7");
    await user.click(trigger);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      expect.stringContaining("Sprint 7"),
      expect.stringContaining("Sprint 8"),
      "All open",
    ]);
    await user.click(screen.getByRole("option", { name: /Sprint 8/ }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/STK/board?sprint=${PLANNED}&types=bug`, {
        scroll: false,
      }),
    );
  });

  it("goes back to the plain URL for the active sprint", async () => {
    const user = userEvent.setup();
    render(
      <BoardSprintPicker
        projectKey="STK"
        selection={{ scope: "sprint", sprintId: PLANNED }}
        sprints={sprints}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Sprint" }));
    await user.click(screen.getByRole("option", { name: /Sprint 7/ }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/STK/board", { scroll: false }));
  });

  it("keeps the picked sprint in the URL when the board view changes", async () => {
    const user = userEvent.setup();
    render(
      <Board
        issues={[issue(1, { type: "bug" })]}
        statuses={statuses}
        {...viewProps}
        selection={{ scope: "sprint", sprintId: PLANNED }}
        projectKey="STK"
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Type: all types" }));
    await user.click(screen.getByRole("option", { name: "Bug" }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(`/STK/board?sprint=${PLANNED}&types=bug`, {
        scroll: false,
      }),
    );
  });
});
