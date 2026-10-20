// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  addTodoAction: vi.fn(),
  editTodoAction: vi.fn(),
  setTodoDoneAction: vi.fn(),
  deleteTodoAction: vi.fn(),
  moveTodoAction: vi.fn(),
}));
vi.mock("@/server/actions/todos", () => actions);

const quickCreate = vi.hoisted(() => ({ openQuickCreate: vi.fn() }));
vi.mock("@/features/issue/quick-create-events", () => quickCreate);

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { TodoList } = await import("./todo-list");

const A = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const B = "0f1e2d3c-4b5a-4968-8776-5544332211aa";
const C = "11111111-2222-4333-8444-555555555555";
const todos = [
  { id: A, text: "Alpha", done: false, promotedIssue: null },
  { id: B, text: "Beta", done: false, promotedIssue: { key: "STK-9", href: "/STK/issues/STK-9" } },
  { id: C, text: "Gamma", done: true, promotedIssue: null },
];

describe("TodoList (MY-2/3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const action of Object.values(actions)) {
      action.mockResolvedValue({ ok: true, data: undefined });
    }
  });

  it("adds with Enter and clears the field", async () => {
    actions.addTodoAction.mockResolvedValue({ ok: true, data: { id: "n" } });
    const user = userEvent.setup();
    render(<TodoList todos={todos} />);
    const field = screen.getByLabelText("Add a todo");
    await user.type(field, "  Call   the bank {Enter}");
    expect(actions.addTodoAction).toHaveBeenCalledWith({ text: "Call the bank" });
    expect(field).toHaveValue("");
  });

  it("collapses completed todos into a Completed section", async () => {
    const user = userEvent.setup();
    render(<TodoList todos={todos} />);
    const toggle = screen.getByRole("button", { name: "Completed (1)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Gamma")).not.toBeVisible();
    await user.click(toggle);
    expect(screen.getByLabelText("Gamma")).toBeVisible();
  });

  it("checks off, and reorders from the keyboard menu", async () => {
    const user = userEvent.setup();
    render(<TodoList todos={todos} />);
    await user.click(screen.getByLabelText("Alpha"));
    expect(actions.setTodoDoneAction).toHaveBeenCalledWith({ todoId: A, done: true });

    await user.click(screen.getByRole("button", { name: "Actions for “Beta”" }));
    await user.click(await screen.findByRole("menuitem", { name: "Move to top" }));
    expect(actions.moveTodoAction).toHaveBeenCalledWith({ todoId: B, afterTodoId: null });
  });

  it("edits inline with Enter and cancels with Escape", async () => {
    const user = userEvent.setup();
    render(<TodoList todos={todos} />);
    await user.click(screen.getByRole("button", { name: "Edit “Alpha”" }));
    const field = screen.getByLabelText("Edit todo");
    await waitFor(() => expect(field).toHaveFocus());
    await user.clear(field);
    await user.type(field, "Alpha two{Enter}");
    expect(actions.editTodoAction).toHaveBeenCalledWith({ todoId: A, text: "Alpha two" });

    await user.click(screen.getByRole("button", { name: /^Edit “Beta”/ }));
    await user.type(screen.getByLabelText("Edit todo"), " nope{Escape}");
    expect(actions.editTodoAction).toHaveBeenCalledTimes(1);
  });

  it("promotes through quick create and shows the key chip once promoted", async () => {
    const user = userEvent.setup();
    render(<TodoList todos={todos} />);
    await user.click(screen.getByRole("button", { name: /Promote “Alpha” to an issue/ }));
    expect(quickCreate.openQuickCreate).toHaveBeenCalledWith({
      title: "Alpha",
      promoteTodoId: A,
    });
    const beta = screen.getByLabelText("Beta").closest("li");
    expect(within(beta ?? document.body).getByRole("link", { name: /STK-9/ })).toHaveAttribute(
      "href",
      "/STK/issues/STK-9",
    );
    expect(within(beta ?? document.body).queryByRole("button", { name: /Promote/ })).toBeNull();
  });

  it("rolls an optimistic delete back when the server refuses", async () => {
    actions.deleteTodoAction.mockResolvedValue({ ok: false, error: "Todo not found" });
    const user = userEvent.setup();
    render(<TodoList todos={todos} />);
    await user.click(screen.getByRole("button", { name: "Actions for “Alpha”" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Todo not found"));
    await waitFor(() => expect(screen.getByLabelText("Alpha")).toBeInTheDocument());
  });
});
