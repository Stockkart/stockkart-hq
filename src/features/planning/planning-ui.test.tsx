// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type PlanningIssue, type StatusOption } from "@/lib/issues/views";

const issueActions = vi.hoisted(() => ({ updateIssueFieldAction: vi.fn() }));
vi.mock("@/server/actions/issues", () => issueActions);
const planningActions = vi.hoisted(() => ({ moveIssueAction: vi.fn() }));
vi.mock("@/server/actions/planning", () => planningActions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
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

const statuses: StatusOption[] = [
  { id: "s-todo", name: "Todo", category: "todo" },
  { id: "s-prog", name: "In Progress", category: "in_progress" },
  { id: "s-done", name: "Done", category: "done" },
];
const ada = { id: "u-ada", name: "Ada Lovelace" };

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
    render(
      <Backlog issues={issues} projectKey="STK" group="none" users={[ada]} filtered={false} />,
    );
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
    render(
      <Backlog issues={issues} projectKey="STK" group="none" users={[ada]} filtered={false} />,
    );
    await user.click(screen.getByRole("button", { name: "Actions for STK-3" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move to top" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Issue not found"));
    // The transition ends just after the toast; then the server order shows again.
    await waitFor(() => expect(rowTitles()).toEqual(["Issue 1", "Issue 2", "Issue 3"]));
  });

  it("groups by assignee with point totals, and collapses a group", async () => {
    const user = userEvent.setup();
    render(
      <Backlog issues={issues} projectKey="STK" group="assignee" users={[ada]} filtered={false} />,
    );
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
    render(
      <Backlog issues={issues} projectKey="STK" group="none" users={[ada]} filtered={false} />,
    );
    const select = screen.getByLabelText("Priority of STK-2");
    await user.selectOptions(select, "0");
    await user.tab();
    await waitFor(() =>
      expect(issueActions.updateIssueFieldAction).toHaveBeenCalledWith({
        issueId: "i2",
        field: "priority",
        value: 0,
      }),
    );
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
    render(<Board issues={issues} statuses={statuses} projectKey="STK" />);
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
    render(<Board issues={issues} statuses={statuses} projectKey="STK" />);
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
    render(<Board issues={issues} statuses={statuses} projectKey="STK" />);
    await user.click(screen.getByRole("button", { name: "Move STK-8 to…" }));
    await user.click(await screen.findByRole("menuitem", { name: "Done" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Status not found"));
    await waitFor(() => {
      const todo = screen.getByRole("region", { name: /Todo/ });
      expect(within(todo).getByRole("link", { name: /STK-8/ })).toBeInTheDocument();
    });
  });
});
