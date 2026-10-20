// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  createIssueAction: vi.fn(),
  loadIssueTemplatesAction: vi.fn(),
}));
vi.mock("@/server/actions/issues", () => actions);

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/my-work",
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// The real editor is client-only and lazy; a textarea stands in for it here.
vi.mock("@/features/editor/lazy-rich-text-editor", () => ({
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
    expect(router.refresh).toHaveBeenCalled();
  });

  it("pre-fills the description from the chosen type's template", async () => {
    const user = userEvent.setup();
    render(<QuickCreate defaultProjectKey="STK" />);
    await user.click(screen.getByRole("button", { name: /create/i }));
    await user.selectOptions(await screen.findByLabelText("Type"), "bug");
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
});
