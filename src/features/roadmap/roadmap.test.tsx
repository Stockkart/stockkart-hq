// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_ROADMAP_FILTERS } from "@/lib/roadmap/filters";
import { type ChildTally, type RoadmapEpic } from "@/lib/roadmap/views";

const issueActions = vi.hoisted(() => ({ updateIssueFieldAction: vi.fn() }));
vi.mock("@/server/actions/issues", () => issueActions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/STK/roadmap",
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    scroll: _scroll,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    scroll?: boolean;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { Roadmap } = await import("./roadmap");

const children = (overrides: Partial<ChildTally> = {}): ChildTally => ({
  total: 4,
  done: 2,
  wontDo: 0,
  points: 10,
  donePoints: 4,
  pointed: 4,
  ...overrides,
});

function epic(n: number, overrides: Partial<RoadmapEpic> = {}): RoadmapEpic {
  return {
    id: `e${n}`,
    key: `STK-${n}`,
    number: n,
    title: `Epic ${n}`,
    status: { id: "s", name: "In Progress", category: "in_progress" },
    assignee: null,
    component: null,
    startDate: "2026-06-01",
    dueDate: "2026-06-14",
    children: children(),
    ...overrides,
  };
}

const props = {
  projectKey: "STK",
  zoom: "month" as const,
  filters: EMPTY_ROADMAP_FILTERS,
  components: [],
  users: [],
  today: "2026-06-05",
};

const bar = (key: string) => screen.getByRole("button", { name: new RegExp(`^${key} `) });

beforeAll(() => {
  // jsdom has no pointer capture.
  HTMLElement.prototype.setPointerCapture = vi.fn();
});

describe("Roadmap (RDM-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issueActions.updateIssueFieldAction.mockResolvedValue({ ok: true, data: {} });
  });

  it("shows a bar per dated epic with its progress, the title linking to the issue", () => {
    render(<Roadmap {...props} epics={[epic(30)]} dependencies={[]} />);
    expect(bar("STK-30")).toHaveAccessibleName(
      "STK-30 Epic 30: Jun 1 – Jun 14, 40% done (4 / 10 pts)",
    );
    expect(screen.getByRole("link", { name: "STK-30 Epic 30" })).toHaveAttribute(
      "href",
      "/STK/issues/STK-30",
    );
    expect(screen.getByText("4 children · 4 / 10 pts")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("shifts a focused bar with the keyboard and saves once, with both dates", async () => {
    const user = userEvent.setup();
    render(<Roadmap {...props} epics={[epic(30)]} dependencies={[]} />);
    bar("STK-30").focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{Shift>}{ArrowRight}{/Shift}");
    // Shown at once (a draft) …
    expect(bar("STK-30")).toHaveAccessibleName(/Jun 10 – Jun 23/);
    // … and saved once the keys rest.
    await waitFor(
      () =>
        expect(issueActions.updateIssueFieldAction).toHaveBeenCalledWith({
          issueId: "e30",
          field: "schedule",
          value: { startDate: "2026-06-10", dueDate: "2026-06-23" },
        }),
      { timeout: 2000 },
    );
    expect(issueActions.updateIssueFieldAction).toHaveBeenCalledTimes(1);
  });

  it("moves only the end with Alt+arrow, and Escape drops unsaved nudges", async () => {
    const user = userEvent.setup();
    render(<Roadmap {...props} epics={[epic(30)]} dependencies={[]} />);
    bar("STK-30").focus();
    await user.keyboard("{Alt>}{ArrowLeft}{ArrowLeft}{/Alt}");
    expect(bar("STK-30")).toHaveAccessibleName(/Jun 1 – Jun 12/);
    await user.keyboard("{Escape}");
    expect(bar("STK-30")).toHaveAccessibleName(/Jun 1 – Jun 14/);
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(issueActions.updateIssueFieldAction).not.toHaveBeenCalled();
  });

  it("saves a pointer drag on drop, snapped to days", async () => {
    render(<Roadmap {...props} epics={[epic(30)]} dependencies={[]} />);
    const target = bar("STK-30");
    // Month zoom: 8 px a day.
    fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 124 });
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 124 });
    await waitFor(() =>
      expect(issueActions.updateIssueFieldAction).toHaveBeenCalledWith({
        issueId: "e30",
        field: "schedule",
        value: { startDate: "2026-06-04", dueDate: "2026-06-17" },
      }),
    );
  });

  it("saves unsaved nudges when Enter opens the date editor, which shows them", async () => {
    // Keep the save in flight: the optimistic dates only live while the transition is
    // pending. With an instantly resolving mock the bar (and the keyed editor) snaps back
    // to the unchanged props before the dialog is queried, which made this test flaky.
    let finishSave: (value: { ok: true; data: object }) => void = () => undefined;
    issueActions.updateIssueFieldAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    const user = userEvent.setup();
    const { rerender } = render(<Roadmap {...props} epics={[epic(30)]} dependencies={[]} />);
    bar("STK-30").focus();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(issueActions.updateIssueFieldAction).toHaveBeenCalledWith({
      issueId: "e30",
      field: "schedule",
      value: { startDate: "2026-06-02", dueDate: "2026-06-15" },
    });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Start date")).toHaveValue("2026-06-02");
    expect(within(dialog).getByLabelText("Due date")).toHaveValue("2026-06-15");

    // The save lands and the server re-renders with the new dates (as revalidation does):
    // the editor keeps showing them.
    rerender(
      <Roadmap
        {...props}
        epics={[epic(30, { startDate: "2026-06-02", dueDate: "2026-06-15" })]}
        dependencies={[]}
      />,
    );
    finishSave({ ok: true, data: {} });
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getByLabelText("Start date")).toHaveValue(
        "2026-06-02",
      ),
    );
    expect(within(screen.getByRole("dialog")).getByLabelText("Due date")).toHaveValue("2026-06-15");
  });

  it("resizes from an edge, and the next click on the bar still opens the editor", async () => {
    const { container } = render(<Roadmap {...props} epics={[epic(30)]} dependencies={[]} />);
    const handles = container.querySelectorAll("span.cursor-ew-resize");
    const end = handles[1];
    if (!end) throw new Error("no end handle");
    fireEvent.pointerDown(end, { button: 0, pointerId: 2, clientX: 200 });
    fireEvent.pointerMove(end, { pointerId: 2, clientX: 216 });
    fireEvent.pointerUp(end, { pointerId: 2, clientX: 216 });
    await waitFor(() =>
      expect(issueActions.updateIssueFieldAction).toHaveBeenCalledWith({
        issueId: "e30",
        field: "schedule",
        value: { startDate: "2026-06-01", dueDate: "2026-06-16" },
      }),
    );
    fireEvent.click(bar("STK-30"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("rolls the bar back when the save fails", async () => {
    issueActions.updateIssueFieldAction.mockResolvedValue({ ok: false, error: "Issue not found" });
    const user = userEvent.setup();
    render(<Roadmap {...props} epics={[epic(30)]} dependencies={[]} />);
    bar("STK-30").focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Issue not found"), {
      timeout: 2000,
    });
    await waitFor(() => expect(bar("STK-30")).toHaveAccessibleName(/Jun 1 – Jun 14/));
  });

  it("lists undated epics as Unscheduled, and sets their dates in the date editor", async () => {
    const user = userEvent.setup();
    render(
      <Roadmap
        {...props}
        epics={[
          epic(30),
          epic(31, {
            startDate: null,
            dueDate: null,
            children: children({ total: 0, done: 0, points: 0, donePoints: 0, pointed: 0 }),
          }),
        ]}
        dependencies={[]}
      />,
    );
    const unscheduled = screen.getByRole("region", { name: /Unscheduled/ });
    expect(within(unscheduled).getByText(/No dates · No child issues/)).toBeInTheDocument();
    await user.click(within(unscheduled).getByRole("button", { name: "Set dates of STK-31" }));
    const dialog = await screen.findByRole("dialog");
    const setDate = (label: string, value: string) =>
      fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    setDate("Start date", "2026-07-01");
    setDate("Due date", "2026-06-01");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "The end date is before the start date",
    );
    setDate("Due date", "2026-07-31");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(issueActions.updateIssueFieldAction).toHaveBeenCalledWith({
        issueId: "e31",
        field: "schedule",
        value: { startDate: "2026-07-01", dueDate: "2026-07-31" },
      }),
    );
  });
});

describe("Roadmap dependencies (RDM-2)", () => {
  it("lists each dependency as a sentence and explains a conflict", () => {
    render(
      <Roadmap
        {...props}
        epics={[
          epic(30, { startDate: "2026-06-01", dueDate: "2026-06-20" }),
          epic(41, { startDate: "2026-06-15", dueDate: "2026-06-30" }),
          epic(50, { startDate: "2026-07-01", dueDate: "2026-07-10" }),
        ]}
        dependencies={[
          { linkId: "a", blockerId: "e30", blockedId: "e41" },
          { linkId: "b", blockerId: "e41", blockedId: "e50" },
        ]}
      />,
    );
    const list = within(screen.getByRole("region", { name: "Dependencies" })).getAllByRole(
      "listitem",
    );
    expect(list[0]).toHaveTextContent(
      "STK-30 blocks STK-41 — conflict: STK-30 is due Jun 20, 5 days after STK-41 starts (Jun 15)",
    );
    expect(list[1]).toHaveTextContent(/^STK-41 blocks STK-50$/);
    expect(bar("STK-41")).toHaveAccessibleName(/dependency conflict$/);
    expect(bar("STK-50")).not.toHaveAccessibleName(/conflict/);
  });
});
