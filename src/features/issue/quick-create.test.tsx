// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  createIssueAction: vi.fn(),
  loadIssueTemplatesAction: vi.fn(),
}));
vi.mock("@/server/actions/issues", () => actions);

const todoActions = vi.hoisted(() => ({ promoteTodoAction: vi.fn() }));
vi.mock("@/server/actions/todos", () => todoActions);

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/my-work",
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// The real editor is client-only and lazy; a textarea stands in for it here.
vi.mock("@/features/editor/lazy-rich-text-editor", () => ({
  preloadRichTextEditor: () => Promise.resolve(),
  LazyRichTextEditor: ({
    label,
    initialContent,
  }: {
    label: string;
    initialContent: { content?: { type: string }[] } | null;
  }) => (
    <div aria-label={label} data-testid="editor">
      {(initialContent?.content ?? []).map((node) => node.type).join(",")}
    </div>
  ),
}));

const { QuickCreate } = await import("./quick-create");

const bugTemplate = { type: "doc", content: [{ type: "heading" }, { type: "orderedList" }] };

describe("QuickCreate (ISS-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.loadIssueTemplatesAction.mockResolvedValue({ ok: true, data: { bug: bugTemplate } });
    actions.createIssueAction.mockResolvedValue({
      ok: true,
      data: { id: "x", number: 7, key: "STK-7" },
    });
  });

  it("opens with C outside inputs and focuses the title", async () => {
    const user = userEvent.setup();
    render(<QuickCreate defaultProjectKey="STK" />);
    await user.keyboard("c");
    const title = await screen.findByLabelText("Title");
    await waitFor(() => expect(title).toHaveFocus());
  });

  it("ignores C while typing in a field", async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="Other field" />
        <QuickCreate defaultProjectKey="STK" />
      </>,
    );
    await user.type(screen.getByLabelText("Other field"), "c");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("creates with only a title and shows the key in a toast", async () => {
    const user = userEvent.setup();
    render(<QuickCreate defaultProjectKey="STK" />);
    await user.click(screen.getByRole("button", { name: /create/i }));
    await user.type(await screen.findByLabelText("Title"), "Fix OOM on upload");
    await user.click(screen.getByRole("button", { name: "Create issue" }));

    await waitFor(() => expect(actions.createIssueAction).toHaveBeenCalledTimes(1));
    expect(actions.createIssueAction).toHaveBeenCalledWith({
      projectKey: "STK",
      title: "Fix OOM on upload",
      type: "task",
      priority: 2,
      description: null,
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("STK-7 created", expect.anything()),
    );
    // The action re-renders the open page in its own response; a second fetch is waste.
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("pre-fills the description from the chosen type's template", async () => {
    const user = userEvent.setup();
    render(<QuickCreate defaultProjectKey="STK" />);
    await user.click(screen.getByRole("button", { name: /create/i }));
    // Our own picker: open it and choose the option (keyboard and mouse both work).
    await user.click(await screen.findByRole("combobox", { name: "Type" }));
    await user.click(screen.getByRole("option", { name: "Bug" }));
    await waitFor(() =>
      expect(screen.getByTestId("editor")).toHaveTextContent("heading,orderedList"),
    );
  });

  it("requires a title and reports server errors in an alert", async () => {
    const user = userEvent.setup();
    render(<QuickCreate defaultProjectKey="STK" />);
    await user.click(screen.getByRole("button", { name: /create/i }));
    await user.click(await screen.findByRole("button", { name: "Create issue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Title is required");
    expect(actions.createIssueAction).not.toHaveBeenCalled();

    actions.createIssueAction.mockResolvedValue({ ok: false, error: "Project STK not found" });
    await user.type(screen.getByLabelText("Title"), "x");
    await user.click(screen.getByRole("button", { name: "Create issue" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Project STK not found"),
    );
  });

  it("promotes a todo (MY-3): pre-filled title, promote action, then the callback", async () => {
    const { openQuickCreate } = await import("./quick-create-events");
    todoActions.promoteTodoAction.mockResolvedValue({
      ok: true,
      data: { id: "x", number: 8, key: "STK-8" },
    });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<QuickCreate defaultProjectKey="STK" />);
    act(() =>
      openQuickCreate({ title: "  Write   the runbook ", promoteTodoId: TODO_ID, onCreated }),
    );
    const title = await screen.findByLabelText("Title");
    expect(title).toHaveValue("Write the runbook");
    expect(screen.getByRole("heading", { name: /promote todo/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create issue" }));

    await waitFor(() => expect(todoActions.promoteTodoAction).toHaveBeenCalledTimes(1));
    expect(todoActions.promoteTodoAction).toHaveBeenCalledWith(
      expect.objectContaining({ todoId: TODO_ID, title: "Write the runbook", projectKey: "STK" }),
    );
    expect(actions.createIssueAction).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({ id: "x", number: 8, key: "STK-8" }),
    );

    // The request was for that one dialog: a later plain create does not promote again.
    await user.keyboard("c");
    await user.type(await screen.findByLabelText("Title"), "Plain");
    await user.click(screen.getByRole("button", { name: "Create issue" }));
    await waitFor(() => expect(actions.createIssueAction).toHaveBeenCalledTimes(1));
    expect(todoActions.promoteTodoAction).toHaveBeenCalledTimes(1);
  });

  it("picks type and priority with the keyboard and creates with them", async () => {
    const user = userEvent.setup();
    render(<QuickCreate defaultProjectKey="STK" />);
    await user.click(screen.getByRole("button", { name: /create/i }));
    await user.type(await screen.findByLabelText("Title"), "Keyboard only");
    screen.getByRole("combobox", { name: "Type" }).focus();
    // Type-ahead to "Bug", Enter picks.
    await user.keyboard("b{Enter}");
    const priority = screen.getByRole("combobox", { name: "Priority" });
    priority.focus();
    await user.keyboard("{ArrowDown}{Home}{Enter}");
    expect(priority).toHaveTextContent("P0 Critical");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() =>
      expect(actions.createIssueAction).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Keyboard only", type: "bug", priority: 0 }),
      ),
    );
  });

  it("opens with a requested type, e.g. Create bug from ⌘K", async () => {
    const { openQuickCreate } = await import("./quick-create-events");
    render(<QuickCreate defaultProjectKey="STK" />);
    act(() => openQuickCreate({ type: "bug" }));
    expect(await screen.findByRole("combobox", { name: "Type" })).toHaveTextContent("Bug");
  });
});

const TODO_ID = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
