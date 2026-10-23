// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type SearchResults } from "@/lib/search/schemas";

const searchAction = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/search", () => ({ searchAction }));

const router = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/my-work" }));

const quickCreate = vi.hoisted(() => ({ openQuickCreate: vi.fn() }));
vi.mock("@/features/issue/quick-create-events", () => quickCreate);

// The "New doc" / "New ADR" actions open the slice 3 dialogs, which call these actions.
const docActions = vi.hoisted(() => ({
  createDocAction: vi.fn(),
  createAdrAction: vi.fn(),
  deleteDocAction: vi.fn(),
  loadDocTemplatesAction: vi.fn(),
  moveDocAction: vi.fn(),
  renameDocAction: vi.fn(),
}));
vi.mock("@/server/actions/docs", () => docActions);

const { CommandPalette } = await import("./command-palette");

const results: SearchResults = {
  jump: null,
  issues: [
    {
      kind: "issue",
      id: "i1",
      href: "/STK/issues/STK-45",
      title: "STK-45 Add ShedLock to outbox",
      context: null,
      snippet: {
        text: "<script>alert(1)</script> the outbox runs twice",
        highlights: [[30, 36]],
      },
    },
  ],
  docs: [
    {
      kind: "doc",
      id: "d1",
      href: "/STK/docs/d1",
      title: "ADR-0008 Scheduled outbox dispatch",
      context: null,
      snippet: null,
    },
  ],
  diagrams: [
    {
      kind: "diagram",
      id: "g1",
      href: "/STK/diagrams/g1",
      title: "Email outbox flow",
      context: "Flow",
      snippet: null,
    },
  ],
  comments: [],
  incidents: [
    {
      kind: "incident",
      id: "n1",
      href: "/STK/incidents/INC-3",
      title: "INC-3 Outbox stuck",
      context: "SEV2",
      snippet: null,
    },
  ],
};

async function openPalette() {
  const user = userEvent.setup();
  render(<CommandPalette defaultProjectKey="STK" />);
  await user.keyboard("{Control>}k{/Control}");
  const input = await screen.findByRole("combobox", { name: "Search or jump to" });
  await waitFor(() => expect(input).toHaveFocus());
  return { user, input };
}

const activeOption = (input: HTMLElement) => {
  const id = input.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
};

describe("CommandPalette (SRCH-1/2, §5.7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchAction.mockResolvedValue({ ok: true, data: results });
  });

  it("opens with Ctrl/Cmd+K even from a text field, and Esc closes it", async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="Elsewhere" />
        <CommandPalette defaultProjectKey="STK" />
      </>,
    );
    await user.click(screen.getByLabelText("Elsewhere"));
    await user.keyboard("{Meta>}k{/Meta}");
    const input = await screen.findByRole("combobox");
    await waitFor(() => expect(input).toHaveFocus());
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument());
  });

  it("closes with Ctrl/Cmd+K too and reopens with an empty query", async () => {
    const { user, input } = await openPalette();
    await user.type(input, "outbox");
    await user.keyboard("{Control>}k{/Control}");
    await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument());
    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByRole("combobox")).toHaveValue("");
  });

  it("lists static actions grouped, moves with the arrow keys and runs with Enter", async () => {
    const { user, input } = await openPalette();
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByRole("group", { name: "Actions" })).toBeInTheDocument();
    expect(activeOption(input)).toHaveTextContent("Create issue");
    expect(activeOption(input)).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(activeOption(input)).toHaveTextContent("Go to Backlog");
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}");
    // Wraps around to the last option.
    expect(activeOption(input)).toHaveTextContent("Go to Todos");
    await user.keyboard("{Home}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(router.push).toHaveBeenCalledWith("/STK/backlog");
    await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument());
    expect(searchAction).not.toHaveBeenCalled();
  });

  it("debounces the search and shows results by type with safe snippets", async () => {
    const { user } = await openPalette();
    await user.keyboard("outbox");
    await screen.findByRole("group", { name: "Issues" });
    // One request for the whole word, not one per key.
    expect(searchAction).toHaveBeenCalledTimes(1);
    expect(searchAction).toHaveBeenCalledWith({ q: "outbox" });
    expect(screen.getByRole("group", { name: "Docs" })).toHaveTextContent(
      "ADR-0008 Scheduled outbox dispatch",
    );
    expect(screen.getByRole("group", { name: "Diagrams" })).toHaveTextContent("Email outbox flow");
    // INC-1: incidents are searched too.
    expect(screen.getByRole("group", { name: "Incidents" })).toHaveTextContent(
      "INC-3 Outbox stuck",
    );
    // Stored markup is shown as text: no element is created from it.
    const issue = screen.getByRole("option", { name: /STK-45/ });
    expect(issue).toHaveTextContent("<script>alert(1)</script> the outbox runs twice");
    expect(issue.querySelector("script")).toBeNull();
    expect(issue.querySelector("mark")).toHaveTextContent(/^outbox$/);
    // Results come first; Enter opens the top one.
    await user.keyboard("{Enter}");
    expect(router.push).toHaveBeenCalledWith("/STK/issues/STK-45");
  });

  it("drops a response that arrives after a newer query", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    searchAction
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce({ ok: true, data: { ...results, docs: [] } });
    const { user } = await openPalette();
    await user.keyboard("first");
    await waitFor(() => expect(searchAction).toHaveBeenCalledTimes(1));
    await user.clear(screen.getByRole("combobox"));
    await user.keyboard("second");
    await waitFor(() => expect(searchAction).toHaveBeenCalledTimes(2));
    await screen.findByRole("group", { name: "Issues" });
    resolveFirst({ ok: true, data: results });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("group", { name: "Docs" })).not.toBeInTheDocument();
  });

  it("jumps straight to an issue key with Enter, before the search answers", async () => {
    searchAction.mockImplementation(() => new Promise(() => {}));
    const { user } = await openPalette();
    await user.keyboard("stk-12{Enter}");
    expect(router.push).toHaveBeenCalledWith("/STK/issues/STK-12");
  });

  it("opens a doc result on its /STK/docs/<id> page", async () => {
    searchAction.mockResolvedValue({ ok: true, data: { ...results, issues: [] } });
    const { user } = await openPalette();
    await user.keyboard("outbox");
    await screen.findByRole("group", { name: "Docs" });
    await user.keyboard("{Enter}");
    expect(router.push).toHaveBeenCalledWith("/STK/docs/d1");
  });

  it("opens the New ADR dialog and creates the ADR in the current project", async () => {
    searchAction.mockResolvedValue({
      ok: true,
      data: { jump: null, issues: [], docs: [], diagrams: [], comments: [], incidents: [] },
    });
    docActions.createAdrAction.mockResolvedValue({
      ok: true,
      data: { id: "a1", title: "ADR-0009 Use Postgres" },
    });
    const { user } = await openPalette();
    await user.keyboard("new adr{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "New ADR" });
    await user.type(within(dialog).getByLabelText("Decision title"), "Use Postgres");
    await user.click(within(dialog).getByRole("button", { name: "Create ADR" }));
    // Docs UX: a new ADR opens in edit mode.
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/STK/docs/a1?edit=1"));
    expect(docActions.createAdrAction).toHaveBeenCalledWith({
      projectKey: "STK",
      title: "Use Postgres",
    });
  });

  it("opens the New doc dialog from the New doc action", async () => {
    searchAction.mockResolvedValue({
      ok: true,
      data: { jump: null, issues: [], docs: [], diagrams: [], comments: [], incidents: [] },
    });
    const { user } = await openPalette();
    await user.keyboard("new doc{Enter}");
    expect(await screen.findByRole("dialog", { name: "New page" })).toBeInTheDocument();
  });

  it("opens quick create as a bug from the Create bug action", async () => {
    searchAction.mockResolvedValue({
      ok: true,
      data: { jump: null, issues: [], docs: [], diagrams: [], comments: [], incidents: [] },
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { user } = await openPalette();
      await user.keyboard("create bug");
      await user.keyboard("{Enter}");
      await vi.runAllTimersAsync();
      expect(quickCreate.openQuickCreate).toHaveBeenCalledWith({ type: "bug" });
    } finally {
      vi.useRealTimers();
    }
  });
});
