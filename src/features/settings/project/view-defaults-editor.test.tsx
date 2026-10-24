// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type StatusSetting } from "@/lib/settings/views";

const settingsActions = vi.hoisted(() => ({ saveViewDefaultsAction: vi.fn() }));
vi.mock("@/server/actions/settings", () => settingsActions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { ViewDefaultsEditor } = await import("./view-defaults-editor");

const status = (id: string, name: string, position: number): StatusSetting => ({
  id,
  name,
  category: "todo",
  position,
  isDefaultFor: null,
  wipLimit: null,
  issueCount: 0,
  trashedCount: 0,
});
const statuses = [status("s-triage", "Triage", 0), status("s-todo", "Todo", 1)];
const none = { issueTypes: null, hiddenStatusIds: [] };

describe("ViewDefaultsEditor (Views tab, BRD-6 / VW-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsActions.saveViewDefaultsAction.mockResolvedValue({ ok: true, data: undefined });
  });

  it("saves default types and hidden statuses, sending only the edited side", async () => {
    const user = userEvent.setup();
    render(
      <ViewDefaultsEditor
        projectKey="STK"
        statuses={statuses}
        defaults={{ board: none, list: { issueTypes: ["bug"], hiddenStatusIds: [] } }}
      />,
    );
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    const board = screen.getByRole("region", { name: "Board" });
    // "All types" while none is chosen.
    expect(
      within(board).getByRole("combobox", { name: /Issue types shown by default/ }),
    ).toHaveTextContent("All types");
    await user.click(within(board).getByRole("combobox", { name: /Issue types shown by default/ }));
    await user.click(screen.getByRole("option", { name: "Task" }));
    await user.keyboard("{Escape}");
    await user.click(within(board).getByRole("checkbox", { name: "Triage" }));
    await user.click(save);
    await waitFor(() =>
      expect(settingsActions.saveViewDefaultsAction).toHaveBeenCalledWith({
        projectKey: "STK",
        board: { issueTypes: ["task"], hiddenStatusIds: ["s-triage"] },
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Saved the view defaults");
  });

  it("keeps unsaved edits of one side when the other side's defaults change elsewhere", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ViewDefaultsEditor
        projectKey="STK"
        statuses={statuses}
        defaults={{ board: none, list: none }}
      />,
    );
    const board = () => screen.getByRole("region", { name: "Board" });
    const list = () => screen.getByRole("region", { name: "Issues list" });
    await user.click(within(board()).getByRole("checkbox", { name: "Triage" }));
    rerender(
      <ViewDefaultsEditor
        projectKey="STK"
        statuses={statuses}
        defaults={{ board: none, list: { issueTypes: null, hiddenStatusIds: ["s-todo"] } }}
      />,
    );
    expect(within(board()).getByRole("checkbox", { name: "Triage" })).not.toBeChecked();
    expect(within(list()).getByRole("checkbox", { name: "Todo" })).not.toBeChecked();
  });

  it("keeps at least one status visible per side", async () => {
    const user = userEvent.setup();
    render(
      <ViewDefaultsEditor
        projectKey="STK"
        statuses={statuses}
        defaults={{ board: none, list: { issueTypes: null, hiddenStatusIds: ["s-triage"] } }}
      />,
    );
    const list = screen.getByRole("region", { name: "Issues list" });
    expect(within(list).getByRole("checkbox", { name: "Triage" })).not.toBeChecked();
    expect(within(list).getByRole("checkbox", { name: "Todo" })).toBeDisabled();
    const board = screen.getByRole("region", { name: "Board" });
    await user.click(within(board).getByRole("checkbox", { name: "Todo" }));
    expect(within(board).getByRole("checkbox", { name: "Triage" })).toBeDisabled();
  });

  it("shows a refusal from the server", async () => {
    settingsActions.saveViewDefaultsAction.mockResolvedValue({
      ok: false,
      error: "Keep at least one status visible",
    });
    const user = userEvent.setup();
    render(
      <ViewDefaultsEditor
        projectKey="STK"
        statuses={statuses}
        defaults={{ board: none, list: none }}
      />,
    );
    await user.click(
      within(screen.getByRole("region", { name: "Board" })).getByRole("checkbox", {
        name: "Triage",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Keep at least one status visible"),
    );
  });
});
