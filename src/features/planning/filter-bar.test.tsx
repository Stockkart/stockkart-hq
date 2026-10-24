// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_FILTERS } from "@/lib/issues/filters";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/STK/issues",
}));
const settingsActions = vi.hoisted(() => ({ saveViewDefaultsAction: vi.fn() }));
vi.mock("@/server/actions/settings", () => settingsActions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { FilterBar } = await import("./filter-bar");

const options = {
  statuses: [
    { id: "s-todo", name: "Todo", category: "todo" as const },
    { id: "s-prog", name: "In Progress", category: "in_progress" as const },
  ],
  components: [],
  labels: [],
  users: [{ id: "u-ada", name: "Ada Lovelace" }],
};

describe("FilterBar (VW-1) with multi-selects", () => {
  beforeEach(() => vi.clearAllMocks());

  it("picks several values of one filter without closing, each into the URL", async () => {
    const user = userEvent.setup();
    render(<FilterBar filters={EMPTY_FILTERS} options={options} />);
    const status = screen.getByRole("combobox", { name: "Status: any" });
    await user.click(status);
    const listbox = screen.getByRole("listbox", { name: "Status" });
    expect(listbox).toHaveAttribute("aria-multiselectable", "true");
    await user.click(screen.getByRole("option", { name: "Todo" }));
    await user.click(screen.getByRole("option", { name: "In Progress" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(2));
    const last = String(router.replace.mock.calls.at(-1)?.[0]);
    expect(last).toContain("s-todo");
    expect(last).toContain("s-prog");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("filters by assignee from the keyboard, including Me", async () => {
    const user = userEvent.setup();
    render(<FilterBar filters={EMPTY_FILTERS} options={options} />);
    screen.getByRole("combobox", { name: "Assignee: any" }).focus();
    await user.keyboard("{Enter}{Enter}{Escape}");
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(String(router.replace.mock.calls[0]?.[0])).toMatch(/assignee=me/);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("FilterBar with the issue-list defaults (VW-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsActions.saveViewDefaultsAction.mockResolvedValue({ ok: true, data: undefined });
  });

  // Defaults: bugs only, "In Progress" hidden (so Todo is the one status shown).
  const listDefaults = {
    types: ["bug" as const],
    statuses: ["s-todo"],
    statusIds: ["s-todo", "s-prog"],
    canonical: true,
  };
  const atDefaults = { ...EMPTY_FILTERS, types: ["bug" as const], statuses: ["s-todo"] };

  it("shows the defaults as active chips, with Show all but no Clear or Save", () => {
    render(
      <FilterBar
        filters={atDefaults}
        options={options}
        listDefaults={listDefaults}
        projectKey="STK"
      />,
    );
    expect(screen.getByRole("combobox", { name: "Type: Bug" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status: Todo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save as default" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show all" })).toBeInTheDocument();
  });

  it("Show all drops the defaults with type=all; Clear returns to them", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <FilterBar
        filters={atDefaults}
        options={options}
        listDefaults={listDefaults}
        projectKey="STK"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Show all" }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/STK/issues?type=all", { scroll: false }),
    );
    rerender(
      <FilterBar
        filters={{ ...EMPTY_FILTERS, priorities: [0] }}
        options={options}
        listDefaults={listDefaults}
        projectKey="STK"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenLastCalledWith("/STK/issues", { scroll: false }),
    );
  });

  it("saves the shown types and statuses as the defaults (hidden = statuses not picked)", async () => {
    const user = userEvent.setup();
    render(
      <FilterBar
        filters={{ ...EMPTY_FILTERS, types: ["task"], statuses: ["s-prog"] }}
        options={options}
        listDefaults={listDefaults}
        projectKey="STK"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save as default" }));
    await waitFor(() =>
      expect(settingsActions.saveViewDefaultsAction).toHaveBeenCalledWith({
        projectKey: "STK",
        list: { issueTypes: ["task"], hiddenStatusIds: ["s-todo"] },
      }),
    );
    // They are the defaults now: the plain URL shows them.
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/STK/issues", { scroll: false }),
    );
  });
});
