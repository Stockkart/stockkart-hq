// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UPLOAD_NODE } from "@/lib/attachments/nodes";
import { COMMENT_ANCHOR_MARK } from "@/lib/doc-comments/anchors";
import { type RichTextDoc } from "@/lib/rich-text";
import { body, DOC_ID, docDetail, thread, treeItem, USER_ID } from "@/test/doc-fixtures";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
const docActions = vi.hoisted(() => ({
  saveDocAction: vi.fn(),
  updateDocMetaAction: vi.fn(),
  restoreDocVersionAction: vi.fn(),
  loadDocVersionAction: vi.fn(),
  supersedeAdrAction: vi.fn(),
  linkDocIssueAction: vi.fn(),
  unlinkDocIssueAction: vi.fn(),
  deleteDocAction: vi.fn(),
  moveDocAction: vi.fn(),
  createDocAction: vi.fn(),
  createAdrAction: vi.fn(),
  renameDocAction: vi.fn(),
  loadDocTemplatesAction: vi.fn(),
}));
vi.mock("@/server/actions/docs", () => docActions);
const commentActions = vi.hoisted(() => ({
  createDocCommentAction: vi.fn(),
  deleteDocCommentAction: vi.fn(),
  editDocCommentAction: vi.fn(),
  resolveDocThreadAction: vi.fn(),
}));
vi.mock("@/server/actions/doc-comments", () => commentActions);
vi.mock("@/server/actions/attachments", () => ({
  adoptCommentAttachmentsAction: vi.fn(),
  deleteAttachmentAction: vi.fn(),
}));
vi.mock("@/server/actions/search", () => ({ searchAction: vi.fn() }));
vi.mock("@/server/actions/handbook", () => ({
  handbookPublishPreviewAction: vi.fn(),
  handbookPublishAction: vi.fn(),
  handbookPullPreviewAction: vi.fn(),
  handbookPullApplyAction: vi.fn(),
}));
// The Tiptap editor is not loaded in jsdom: a labelled textarea stands in for it.
vi.mock("@/features/editor/lazy-rich-text-editor", () => ({
  LazyRichTextEditor: ({
    label,
    onChange,
  }: {
    label: string;
    onChange?: (content: RichTextDoc) => void;
  }) => (
    <label>
      {label}
      <textarea
        onChange={(event) =>
          onChange?.(
            // "UPLOAD" stands for an image still uploading (its placeholder node).
            event.target.value.endsWith("UPLOAD")
              ? { type: "doc", content: [{ type: UPLOAD_NODE, attrs: { id: "u1" } }] }
              : body(event.target.value),
          )
        }
      />
    </label>
  ),
  preloadRichTextEditor: vi.fn(),
}));

const { DocScreen } = await import("./doc-screen");

type Props = Parameters<typeof DocScreen>[0];

function props(patch: Partial<Props> = {}): Props {
  return {
    doc: docDetail(),
    ancestors: [{ id: "parent-1", title: "Handbook" }],
    projectKeys: ["STK"],
    users: [{ id: USER_ID, name: "Ada", email: "ada@example.test" }],
    adrs: [],
    supersedes: [],
    linkedIssues: [],
    versions: [
      { version: 3, authorName: "Ada", createdAt: new Date("2026-01-02T10:00:00Z") },
      { version: 1, authorName: "Ada", createdAt: new Date("2026-01-01T10:00:00Z") },
    ],
    tree: [
      treeItem("parent-1", "Handbook"),
      treeItem(DOC_ID, "Runbook", "parent-1"),
      treeItem("other-1", "Architecture", null, "a1"),
    ],
    comments: { threads: [], currentUser: { id: USER_ID, name: "Ada" } },
    ...patch,
  };
}

function at(url: string) {
  window.history.replaceState(null, "", url);
}

const editorBox = () => screen.queryByRole("textbox", { name: "Document" });

/** Selects characters [from, to) of the text node holding `text` and reports it. */
function selectText(text: string, from: number, to: number) {
  const element = screen.getByText(text);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (!node) throw new Error(`no text node for ${text}`);
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, to);
  act(() => {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}

beforeEach(() => {
  // jsdom has no layout; the comments panel scrolls threads into view.
  Element.prototype.scrollIntoView = vi.fn();
  at(`/STK/docs/${DOC_ID}`);
  window.localStorage.clear();
  for (const mock of [...Object.values(docActions), ...Object.values(commentActions)]) {
    mock.mockReset();
  }
  router.refresh.mockReset();
  router.push.mockReset();
  docActions.saveDocAction.mockImplementation(async (input: { baseVersion: number }) => ({
    ok: true,
    data: { status: "saved", version: input.baseVersion + 1, snapshotted: false },
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("read mode by default", () => {
  it("renders the doc read-only: no editor, toolbar, title field or pickers", () => {
    render(<DocScreen {...props()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Runbook" })).toBeInTheDocument();
    expect(screen.getByText("First paragraph of the runbook.")).toBeInTheDocument();
    expect(editorBox()).not.toBeInTheDocument();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    // Metadata as quiet chips.
    const details = screen.getByRole("list", { name: "Details" });
    expect(within(details).getByText("Page")).toBeInTheDocument();
    expect(within(details).getByText("Draft")).toBeInTheDocument();
    expect(within(details).getByText("Owner: Ada")).toBeInTheDocument();
    // Compact breadcrumb: every crumb is a link.
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(
      within(crumbs)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Docs", "Handbook", "Runbook"]);
  });

  it("Edit switches to edit mode with the URL, and Done saves and comes back", async () => {
    const user = userEvent.setup();
    render(<DocScreen {...props()} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(window.location.search).toBe("?edit=1");
    expect(await screen.findByRole("textbox", { name: "Document" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Runbook");
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);

    await user.type(screen.getByRole("textbox", { name: "Document" }), "Rewritten");
    // Done flushes the pending save at once (no 2 s wait), then reads again.
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(editorBox()).not.toBeInTheDocument());
    expect(docActions.saveDocAction).toHaveBeenCalledWith(
      expect.objectContaining({ docId: DOC_ID, baseVersion: 3, content: body("Rewritten") }),
    );
    expect(window.location.search).toBe("");
    expect(screen.getByText("Rewritten")).toBeInTheDocument();
  });

  it("opens in edit mode from ?edit=1", async () => {
    at(`/STK/docs/${DOC_ID}?edit=1`);
    render(<DocScreen {...props()} />);
    expect(await screen.findByRole("textbox", { name: "Document" })).toBeInTheDocument();
  });

  it("warns before leaving edit mode when the save failed", async () => {
    const user = userEvent.setup();
    docActions.saveDocAction.mockResolvedValue({ ok: false, error: "Offline" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    at(`/STK/docs/${DOC_ID}?edit=1`);
    render(<DocScreen {...props()} />);
    await user.type(await screen.findByRole("textbox", { name: "Document" }), "x");
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    // Stayed: the editor is still there.
    expect(editorBox()).toBeInTheDocument();
    expect(window.location.search).toBe("?edit=1");
  });
});

describe("leaving edit mode", () => {
  it("waits for a running upload instead of dropping it", async () => {
    const user = userEvent.setup();
    at(`/STK/docs/${DOC_ID}?edit=1`);
    render(<DocScreen {...props()} />);
    await user.type(await screen.findByRole("textbox", { name: "Document" }), "UPLOAD");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(editorBox()).toBeInTheDocument();
    expect(window.location.search).toBe("?edit=1");
  });
});

describe("keyboard", () => {
  it("E edits (not while typing); Esc and ⌘/Ctrl+Enter are Done (not inside a menu)", async () => {
    const user = userEvent.setup();
    render(
      <>
        <label>
          Notes <input />
        </label>
        <DocScreen {...props()} />
      </>,
    );
    await user.type(screen.getByRole("textbox", { name: "Notes" }), "e");
    expect(editorBox()).not.toBeInTheDocument();
    await user.click(document.body);
    await user.keyboard("e");
    expect(await screen.findByRole("textbox", { name: "Document" })).toBeInTheDocument();

    // Esc inside the ⋯ menu closes the menu, not edit mode.
    await user.click(screen.getByRole("button", { name: "More actions for Runbook" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(editorBox()).toBeInTheDocument();

    await user.click(screen.getByRole("textbox", { name: "Title" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(editorBox()).not.toBeInTheDocument());

    await user.keyboard("e");
    await user.click(await screen.findByRole("textbox", { name: "Document" }));
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(editorBox()).not.toBeInTheDocument());
  });
});

describe("pages drawer and pin", () => {
  it("[ opens the drawer; search filters, ↓ moves into the tree, Esc closes", async () => {
    const user = userEvent.setup();
    render(<DocScreen {...props()} />);
    // No persistent tree on the doc page.
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();
    await user.keyboard("[[");
    const drawer = await screen.findByRole("dialog", { name: "Pages" });
    const search = within(drawer).getByRole("searchbox", { name: "Search pages" });
    await user.type(search, "arch");
    const tree = within(drawer).getByRole("navigation", { name: "Pages" });
    expect(
      within(tree).getAllByRole("link", { name: /Architecture|Runbook|Handbook/ }),
    ).toHaveLength(1);
    await user.keyboard("{ArrowDown}");
    expect(within(tree).getByRole("link", { name: "Architecture" })).toHaveFocus();
    await user.clear(search);
    await user.click(search);
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    expect(within(tree).getByRole("link", { name: "Runbook" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pages" })).toBeNull());
  });

  it("pins the tree as a column, remembered per browser", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DocScreen {...props()} />);
    await user.click(screen.getByRole("button", { name: "Pages" }));
    await user.click(await screen.findByRole("button", { name: "Pin" }));
    expect(JSON.parse(window.localStorage.getItem("hq.docs.pages") ?? "{}")).toEqual({
      pinned: true,
      width: 240,
    });
    const handle = await screen.findByRole("separator", { name: "Resize the page tree" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(JSON.parse(window.localStorage.getItem("hq.docs.pages") ?? "{}").width).toBe(256);
    unmount();
    render(<DocScreen {...props()} />);
    expect(screen.getByRole("button", { name: "Unpin" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Pages" })).toBeInTheDocument();
  });
});

describe("side panel", () => {
  it("is collapsed by default and opens one panel at a time", async () => {
    const user = userEvent.setup();
    render(<DocScreen {...props()} />);
    const panel = document.getElementById("doc-side-panel");
    expect(panel).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: "History" }));
    expect(panel).toBeVisible();
    expect(screen.getByRole("button", { name: "History" })).toHaveAttribute("aria-pressed", "true");
    expect(within(panel ?? document.body).getByText("v1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(within(panel ?? document.body).queryByText("v1")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(panel).not.toBeVisible();
  });

  it("opens Comments by itself for a #comment-<id> link", async () => {
    const open = thread();
    at(`/STK/docs/${DOC_ID}#comment-${open.id}`);
    render(
      <DocScreen
        {...props({ comments: { threads: [open], currentUser: { id: USER_ID, name: "Ada" } } })}
      />,
    );
    const panel = document.getElementById("doc-side-panel");
    await waitFor(() => expect(panel).toBeVisible());
    expect(screen.getByRole("button", { name: "Comments (1)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() => expect(document.getElementById(`thread-${open.id}`)).toHaveFocus());
  });
});

describe("inline comment from read mode (DOC-13)", () => {
  it("marks the selection through a locked save, then opens the composer", async () => {
    const user = userEvent.setup();
    render(<DocScreen {...props()} />);
    selectText("First paragraph of the runbook.", 6, 15);
    await user.click(await screen.findByRole("button", { name: /Comment on the selected text/ }));
    await waitFor(() => expect(docActions.saveDocAction).toHaveBeenCalledTimes(1));
    const [saved] = docActions.saveDocAction.mock.calls[0] ?? [];
    expect(saved).toMatchObject({ docId: DOC_ID, baseVersion: 3 });
    const first = (saved as { content: RichTextDoc }).content.content?.[0]?.content ?? [];
    expect(first).toEqual([
      { type: "text", text: "First " },
      {
        type: "text",
        text: "paragraph",
        marks: [{ type: COMMENT_ANCHOR_MARK, attrs: { anchorId: expect.any(String) } }],
      },
      { type: "text", text: " of the runbook." },
    ]);
    // The comments panel opened with the composer for the quote.
    expect(
      await screen.findByRole("textbox", { name: "Comment on the selected text" }),
    ).toBeVisible();
    expect(document.getElementById("doc-side-panel")).toBeVisible();
  });

  it("does not open the composer when the doc changed meanwhile (conflict)", async () => {
    const user = userEvent.setup();
    docActions.saveDocAction.mockResolvedValue({
      ok: true,
      data: {
        status: "conflict",
        latest: {
          version: 4,
          title: "Runbook",
          content: null,
          updatedByName: "Bo",
          updatedAt: new Date(),
        },
      },
    });
    render(<DocScreen {...props()} />);
    selectText("Second paragraph.", 0, 6);
    await user.click(await screen.findByRole("button", { name: /Comment on the selected text/ }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(screen.queryByRole("textbox", { name: "Comment on the selected text" })).toBeNull();
  });
});

describe("ADR banners (ADR-3)", () => {
  it("shows Superseded by and Supersedes with links", () => {
    render(
      <DocScreen
        {...props({
          doc: docDetail({
            type: "adr",
            title: "0007. Use cron",
            adrNumber: 7,
            adrStatus: "superseded",
            adrSupersededBy: { id: "new-adr", title: "0009. Use a queue" },
          }),
          supersedes: [{ id: "older", title: "0003. Old", adrNumber: 3 }],
        })}
      />,
    );
    expect(screen.getByRole("link", { name: "ADR-0009" })).toHaveAttribute(
      "href",
      "/STK/docs/new-adr",
    );
    expect(screen.getByRole("link", { name: "ADR-0003" })).toHaveAttribute(
      "href",
      "/STK/docs/older",
    );
    // The breadcrumb names the ADR by number.
    expect(
      within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", {
        name: "ADR-0007",
      }),
    ).toBeInTheDocument();
  });
});
