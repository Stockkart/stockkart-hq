// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { type SprintSummary } from "@/lib/sprints/views";

import {
  CompleteSprintDialog,
  DeleteSprintDialog,
  SprintFormDialog,
  StartSprintDialog,
} from "./sprint-dialogs";

const sprint: SprintSummary = {
  id: "sp-7",
  name: "Sprint 7",
  goal: "Make 2 containers safe",
  startDate: "2026-06-02",
  endDate: "2026-06-15",
  state: "planned",
  closedAt: null,
  open: { count: 3, points: 13 },
  done: { count: 2, points: 5 },
  wontDo: { count: 1, points: 8 },
};

describe("StartSprintDialog (SPR-1)", () => {
  it("shows the commitment and starts with Enter on the focused button", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <StartSprintDialog
        open
        onOpenChange={vi.fn()}
        sprint={sprint}
        activeSprintName={null}
        onConfirm={onConfirm}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Start Sprint 7?" });
    expect(dialog).toHaveTextContent("3 issues");
    expect(dialog).toHaveTextContent("13 pts");
    expect(dialog).toHaveTextContent("Jun 2 – Jun 15");
    expect(dialog).toHaveTextContent("Make 2 containers safe");
    const start = screen.getByRole("button", { name: "Start sprint" });
    await waitFor(() => expect(start).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("is blocked while another sprint is active, focusing Cancel", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <StartSprintDialog
        open
        onOpenChange={onOpenChange}
        sprint={sprint}
        activeSprintName="Sprint 6"
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Sprint 6 is active");
    expect(screen.getByRole("button", { name: "Start sprint" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("CompleteSprintDialog (SPR-2)", () => {
  const active = { ...sprint, state: "active" as const };

  it("shows done vs open and picks the backlog with the arrow keys", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <CompleteSprintDialog
        open
        onOpenChange={vi.fn()}
        sprint={active}
        nextSprintName="Sprint 8"
        newSprintName="Sprint 9"
        onConfirm={onConfirm}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Complete Sprint 7?" });
    expect(dialog).toHaveTextContent("2 issues · 5 pts");
    expect(dialog).toHaveTextContent("3 issues · 13 pts");
    const next = screen.getByRole("radio", { name: "The next sprint: Sprint 8" });
    await waitFor(() => expect(next).toHaveFocus());
    expect(next).toBeChecked();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "The backlog" })).toBeChecked();
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledWith("backlog");
  });

  it("offers a new sprint when none is planned", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <CompleteSprintDialog
        open
        onOpenChange={vi.fn()}
        sprint={active}
        nextSprintName={null}
        newSprintName="Sprint 9"
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("radio", { name: "A new sprint (Sprint 9)" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Complete sprint" }));
    expect(onConfirm).toHaveBeenCalledWith("next");
  });
});

describe("SprintFormDialog (SPR-1)", () => {
  it("fills the end from the start and submits with Enter", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <SprintFormDialog
        open
        onOpenChange={vi.fn()}
        mode="create"
        sprintLengthDays={14}
        initial={{ name: "Sprint 3", goal: null, startDate: "2026-06-01", endDate: "2026-06-14" }}
        onConfirm={onConfirm}
      />,
    );
    const name = screen.getByLabelText("Name");
    await waitFor(() => expect(name).toHaveFocus());
    await user.keyboard("{Tab}Ship the board");
    const start = screen.getByLabelText("Start date");
    // A native date input; jsdom has no picker, so set its value directly.
    fireEvent.change(start, { target: { value: "2026-07-01" } });
    expect(screen.getByLabelText("End date")).toHaveValue("2026-07-14");
    await user.click(name);
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledWith({
      name: "Sprint 3",
      goal: "Ship the board",
      startDate: "2026-07-01",
      endDate: "2026-07-14",
    });
  });

  it("reports an end before the start in a live region", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <SprintFormDialog
        open
        onOpenChange={vi.fn()}
        mode="edit"
        sprintLengthDays={14}
        initial={{ name: "Sprint 3", goal: null, startDate: "2026-06-10", endDate: "2026-06-01" }}
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("End date is before the start");
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("DeleteSprintDialog", () => {
  it("focuses Cancel first and says the issues go back to the backlog", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <DeleteSprintDialog open onOpenChange={vi.fn()} sprint={sprint} onConfirm={onConfirm} />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("6 issues go back to the backlog");
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    await user.keyboard("{Tab}{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
