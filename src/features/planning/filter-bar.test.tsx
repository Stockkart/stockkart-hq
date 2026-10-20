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
