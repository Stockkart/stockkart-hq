// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type IssueDetail, type ProjectMeta } from "@/lib/issues/views";

const actions = vi.hoisted(() => ({
  updateIssueFieldAction: vi.fn(),
  addLabelAction: vi.fn(),
  removeLabelAction: vi.fn(),
}));
vi.mock("@/server/actions/issues", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { IssueFields } = await import("./issue-fields");

const ME = "u-me";
const meta: ProjectMeta = {
  statuses: [
    { id: "s-todo", name: "Todo", category: "todo" },
    { id: "s-prog", name: "In Progress", category: "in_progress" },
  ],
  components: [{ id: "c-api", name: "API" }],
  labels: [{ id: "l-ocr", name: "ocr", color: "#ff0000" }],
  users: [
    { id: ME, name: "Me Myself", email: "me@example.test" },
    { id: "u-ada", name: "Ada Lovelace", email: "ada@example.test" },
  ],
  epics: [{ id: "e1", key: "STK-1", title: "Big epic", type: "epic" }],
};
const issue: IssueDetail = {
  id: "i5",
  key: "STK-5",
  number: 5,
  title: "Thing",
  type: "task",
  projectId: "p",
  projectKey: "STK",
  description: null,
  statusId: "s-todo",
  priority: 2,
  assigneeId: null,
  reporter: null,
  componentId: null,
  parent: null,
  storyPoints: null,
  dueDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  resolvedAt: null,
  labels: [],
};

function renderFields() {
  return render(
    <IssueFields issue={issue} meta={meta} parentOptions={meta.epics} currentUserId={ME} />,
  );
}

describe("IssueFields side panel (ISS-5) with our pickers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.updateIssueFieldAction.mockResolvedValue({ ok: true, data: {} });
    actions.addLabelAction.mockImplementation(async ({ name }: { name: string }) => ({
      ok: true,
      data: { labelId: name === "ocr" ? "l-ocr" : `l-${name}` },
    }));
    actions.removeLabelAction.mockResolvedValue({ ok: true, data: undefined });
  });

  it("saves a picked status at once and shows it optimistically", async () => {
    const user = userEvent.setup();
    renderFields();
    const status = screen.getByRole("combobox", { name: "Status" });
    await user.click(status);
    await user.click(screen.getByRole("option", { name: "In Progress" }));
    expect(status).toHaveTextContent("In Progress");
    await waitFor(() =>
      expect(actions.updateIssueFieldAction).toHaveBeenCalledWith({
        issueId: "i5",
        field: "status",
        value: "s-prog",
      }),
    );
  });

  it("assigns and clears with the keyboard (nullable field)", async () => {
    const user = userEvent.setup();
    renderFields();
    const assignee = screen.getByRole("combobox", { name: "Assignee" });
    expect(assignee).toHaveTextContent("Unassigned");
    assignee.focus();
    await user.keyboard("a{Enter}");
    expect(assignee).toHaveTextContent("Ada Lovelace");
    await user.keyboard("{Enter}{Home}{Enter}");
    expect(assignee).toHaveTextContent("Unassigned");
    await waitFor(() => expect(actions.updateIssueFieldAction).toHaveBeenCalledTimes(2));
    expect(actions.updateIssueFieldAction).toHaveBeenLastCalledWith({
      issueId: "i5",
      field: "assignee",
      value: null,
    });
  });

  it("sets the parent epic from its picker", async () => {
    const user = userEvent.setup();
    renderFields();
    await user.click(screen.getByRole("combobox", { name: "Epic" }));
    await user.click(screen.getByRole("option", { name: "STK-1 Big epic" }));
    await waitFor(() =>
      expect(actions.updateIssueFieldAction).toHaveBeenCalledWith({
        issueId: "i5",
        field: "parent",
        value: "e1",
      }),
    );
  });

  it("adds an existing label and creates a new one, optimistically", async () => {
    const user = userEvent.setup();
    renderFields();
    await user.click(screen.getByRole("combobox", { name: "Labels" }));
    await user.click(screen.getByRole("option", { name: "ocr" }));
    const chips = () => within(screen.getByRole("list", { name: "Labels" }));
    expect(chips().getByText("ocr")).toBeInTheDocument();
    expect(actions.addLabelAction).toHaveBeenCalledWith({ issueId: "i5", name: "ocr" });

    await user.keyboard("Needs Review");
    await user.click(screen.getByRole("option", { name: "Create label “needs-review”" }));
    // Shown before the server answers.
    expect(chips().getByText("needs-review")).toBeInTheDocument();
    await waitFor(() =>
      expect(actions.addLabelAction).toHaveBeenCalledWith({ issueId: "i5", name: "needs-review" }),
    );
  });

  it("rolls a label back when the server refuses", async () => {
    const user = userEvent.setup();
    actions.addLabelAction.mockResolvedValue({ ok: false, error: "Nope" });
    renderFields();
    await user.click(screen.getByRole("combobox", { name: "Labels" }));
    await user.click(screen.getByRole("option", { name: "ocr" }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Labels" })).toBeNull());
    expect(toast.error).toHaveBeenCalledWith("Nope");
  });
});
