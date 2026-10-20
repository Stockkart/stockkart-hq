// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type DocTreeItem } from "@/lib/docs/views";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  usePathname: () => "/STK/docs/b",
}));
const actions = vi.hoisted(() => ({
  moveDocAction: vi.fn(),
  createDocAction: vi.fn(),
  createAdrAction: vi.fn(),
  deleteDocAction: vi.fn(),
  renameDocAction: vi.fn(),
  loadDocTemplatesAction: vi.fn(),
}));
vi.mock("@/server/actions/docs", () => actions);

const { DocTree, dropTarget, dropZoneAt } = await import("./doc-tree");
const { ConflictBanner } = await import("./doc-editor");

const item = (id: string, parentId: string | null, position: string): DocTreeItem => ({
  id,
  parentId,
  position,
  title: id.toUpperCase(),
  type: "page",
  status: "draft",
  ownerName: null,
  updatedByName: null,
  updatedAt: new Date(0),
});

// a ─ b ─ c
// d
const docs = [
  item("a", null, "a0"),
  item("b", "a", "a0"),
  item("c", "b", "a0"),
  item("d", null, "a1"),
];

describe("drop rules (DOC-2)", () => {
  it("maps the pointer to before / inside / after", () => {
    expect(dropZoneAt(1, 40)).toBe("before");
    expect(dropZoneAt(20, 40)).toBe("inside");
    expect(dropZoneAt(39, 40)).toBe("after");
  });

  it("nests at the end, or inserts next to the target among its siblings", () => {
    expect(dropTarget(docs, "d", "a", "inside")).toEqual({ parentId: "a", index: 1 });
    expect(dropTarget(docs, "d", "a", "before")).toEqual({ parentId: null, index: 0 });
    expect(dropTarget(docs, "c", "a", "after")).toEqual({ parentId: null, index: 1 });
  });

  it("refuses drops onto the doc itself or below it (no cycles)", () => {
    expect(dropTarget(docs, "a", "a", "inside")).toBeNull();
    expect(dropTarget(docs, "a", "c", "inside")).toBeNull();
    expect(dropTarget(docs, "a", "b", "after")).toBeNull();
  });
});

describe("DocTree", () => {
  beforeEach(() => {
    refresh.mockReset();
    actions.moveDocAction.mockReset().mockResolvedValue({ ok: true, data: undefined });
  });

  it("expands and collapses, and marks the current page", async () => {
    render(<DocTree projectKey="STK" docs={docs} />);
    expect(screen.getByRole("link", { name: "B" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("button", { name: "Collapse A" }));
    expect(screen.queryByRole("link", { name: "B" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Expand A" }));
    expect(screen.getByRole("link", { name: "C" })).toBeInTheDocument();
  });

  it("moves a doc by drag and drop", async () => {
    render(<DocTree projectKey="STK" docs={docs} />);
    const row = (name: string) => screen.getByRole("link", { name }).parentElement as HTMLElement;
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
      effectAllowed: "",
      dropEffect: "",
    };
    fireEvent.dragStart(row("D"), { dataTransfer });
    // jsdom has no layout: every row is 0px tall, which counts as "inside".
    fireEvent.dragOver(row("A"), { dataTransfer, clientY: 0 });
    fireEvent.drop(row("A"), { dataTransfer });
    await waitFor(() =>
      expect(actions.moveDocAction).toHaveBeenCalledWith({ docId: "d", parentId: "a", index: 1 }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("offers Move to… from the row menu (keyboard alternative)", async () => {
    render(<DocTree projectKey="STK" docs={docs} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions for D" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to…" }));
    const parent = await screen.findByRole("combobox", { name: "Parent" });
    expect(parent).toHaveTextContent("Top level");
    await userEvent.selectOptions(parent, "b");
    await userEvent.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() =>
      expect(actions.moveDocAction).toHaveBeenCalledWith({ docId: "d", parentId: "b", index: 0 }),
    );
  });

  it("leaves a doc's own subtree out of its Move to… parents", async () => {
    render(<DocTree projectKey="STK" docs={docs} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions for A" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to…" }));
    const parent = await screen.findByRole("combobox", { name: "Parent" });
    const options = [...parent.querySelectorAll("option")].map((option) => option.value);
    expect(options).toEqual(["__root__", "d"]);
  });
});

describe("ConflictBanner (§7.4)", () => {
  it("names who saved and offers reload, keep mine and copy mine", async () => {
    const onReload = vi.fn();
    const onKeepMine = vi.fn();
    const onCopyMine = vi.fn();
    render(
      <ConflictBanner
        conflict={{ version: 5, title: "T", content: null, updatedByName: "RK" }}
        onReload={onReload}
        onKeepMine={onKeepMine}
        onCopyMine={onCopyMine}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Updated by RK");
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep mine (overwrite)" }));
    await userEvent.click(screen.getByRole("button", { name: "Copy mine" }));
    expect([onReload, onKeepMine, onCopyMine].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
  });
});
