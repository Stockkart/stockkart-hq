// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HANDBOOK_PUBLIC_WARNING } from "@/lib/handbook/constants";
import { type HandbookDocSync } from "@/lib/handbook/views";
import { type RichTextDoc } from "@/lib/rich-text";
import { body, DOC_ID, docDetail, treeItem, USER_ID } from "@/test/doc-fixtures";

const actions = vi.hoisted(() => ({
  handbookPublishPreviewAction: vi.fn(),
  handbookPublishAction: vi.fn(),
  handbookPullPreviewAction: vi.fn(),
  handbookPullApplyAction: vi.fn(),
  handbookCheckAction: vi.fn(),
  handbookImportFileAction: vi.fn(),
}));
vi.mock("@/server/actions/handbook", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
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
vi.mock("@/server/actions/doc-comments", () => ({
  createDocCommentAction: vi.fn(),
  deleteDocCommentAction: vi.fn(),
  editDocCommentAction: vi.fn(),
  resolveDocThreadAction: vi.fn(),
}));
vi.mock("@/server/actions/attachments", () => ({
  adoptCommentAttachmentsAction: vi.fn(),
  deleteAttachmentAction: vi.fn(),
}));
vi.mock("@/server/actions/search", () => ({ searchAction: vi.fn() }));
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
      <textarea onChange={(event) => onChange?.(body(event.target.value))} />
    </label>
  ),
  preloadRichTextEditor: vi.fn(),
}));

const { DocScreen } = await import("../doc-screen");
const { HandbookStatusBadge } = await import("./handbook-status-badge");
const { SAVE_FIRST_MESSAGE } = await import("./publish-dialog");

const REMOTE = "b".repeat(40);
const sync = (
  status: HandbookDocSync["status"],
  patch: Partial<HandbookDocSync> = {},
): HandbookDocSync => ({
  docId: DOC_ID,
  title: "Runbook",
  type: "page",
  path: "RUNBOOK.md",
  status,
  version: 3,
  syncedVersion: 2,
  syncedAt: null,
  remoteSeenAt: null,
  pr: null,
  ...patch,
});
const preview = (patch: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    docId: DOC_ID,
    version: 3,
    path: "RUNBOOK.md",
    markdown: "# Runbook\n\nText.\n",
    remote: null,
    unchanged: false,
    needsOverwrite: false,
    secret: null,
    specialPath: false,
    ...patch,
  },
});
const pullPreview = (state: "repo_ahead" | "both_changed", baseVersion = 3) => ({
  ok: true,
  data: {
    docId: DOC_ID,
    path: "RUNBOOK.md",
    state,
    baseVersion,
    remoteSha: REMOTE,
    diff: [{ kind: "add", text: "theirs", lines: 1, oldStart: 1, newStart: 1 }],
  },
});

type Props = Parameters<typeof DocScreen>[0];

function props(handbook: HandbookDocSync | null, patch: Partial<Props> = {}): Props {
  return {
    doc: docDetail({ handbook }),
    ancestors: [],
    projectKeys: ["STK"],
    users: [{ id: USER_ID, name: "Ada", email: "ada@example.test" }],
    adrs: [],
    supersedes: [],
    linkedIssues: [],
    versions: [{ version: 3, authorName: "Ada", createdAt: new Date("2026-01-02T10:00:00Z") }],
    tree: [treeItem(DOC_ID, "Runbook")],
    handbookConfigured: true,
    comments: { threads: [], currentUser: { id: USER_ID, name: "Ada" } },
    ...patch,
  };
}

const at = (url: string) => window.history.replaceState(null, "", url);
const editorBox = () => screen.queryByRole("textbox", { name: "Document", hidden: true });
const header = () => screen.getByRole("banner");

async function choose(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole("button", { name: "More actions for Runbook" }));
  await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name }));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  at(`/STK/docs/${DOC_ID}`);
  window.localStorage.clear();
  vi.clearAllMocks();
  docActions.saveDocAction.mockImplementation(async (input: { baseVersion: number }) => ({
    ok: true,
    data: { status: "saved", version: input.baseVersion + 1, snapshotted: false },
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handbook status badge (DOC-14)", () => {
  it("labels every status", () => {
    const { rerender } = render(<HandbookStatusBadge status="in_sync" />);
    expect(screen.getByText("In sync")).toBeTruthy();
    rerender(<HandbookStatusBadge status="removed_in_handbook" />);
    expect(screen.getByText("Removed in handbook")).toBeTruthy();
    rerender(
      <HandbookStatusBadge
        status="pr_open"
        pr={{ number: 4, url: "https://github.com/Stockkart/engineering-handbook/pull/4" }}
      />,
    );
    expect(screen.getByRole("link", { name: "PR open #4" })).toBeTruthy();
  });

  it("sits in the doc header in read and in edit mode; nothing for non-files", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DocScreen {...props(sync("in_sync"))} />);
    expect(within(header()).getByText("In sync")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("textbox", { name: "Document" })).toBeInTheDocument();
    expect(within(header()).getByText("In sync")).toBeInTheDocument();
    unmount();
    at(`/STK/docs/${DOC_ID}`);
    render(<DocScreen {...props(null)} />);
    expect(within(header()).queryByText(/sync|handbook/i)).toBeNull();
  });

  it("turns Changed in HQ as soon as an edit is saved on the page", async () => {
    const user = userEvent.setup();
    at(`/STK/docs/${DOC_ID}?edit=1`);
    render(<DocScreen {...props(sync("in_sync", { syncedVersion: 3 }))} />);
    await user.type(await screen.findByRole("textbox", { name: "Document" }), "Edited");
    await user.click(screen.getByRole("button", { name: "Save version" }));
    await waitFor(() => expect(within(header()).getByText("Changed in HQ")).toBeInTheDocument());
  });
});

describe("handbook doc actions (DOC-14)", () => {
  it("are in the ⋯ menu in read and in edit mode, above Delete", async () => {
    const user = userEvent.setup();
    render(<DocScreen {...props(sync("both_changed"))} />);
    const names = async () => {
      await user.click(screen.getByRole("button", { name: "More actions for Runbook" }));
      const menu = screen.getByRole("menu");
      const items = within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent);
      await user.keyboard("{Escape}");
      return items;
    };
    const read = await names();
    expect(read.slice(-3)).toEqual(["Publish to handbook", "Review & pull", "Delete…"]);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await screen.findByRole("textbox", { name: "Document" });
    expect((await names()).slice(-3)).toEqual(read.slice(-3));
  });

  it("disables both actions with the reason when the App is not configured", async () => {
    const user = userEvent.setup();
    render(<DocScreen {...props(sync("both_changed"), { handbookConfigured: false })} />);
    await user.click(screen.getByRole("button", { name: "More actions for Runbook" }));
    const menu = screen.getByRole("menu");
    for (const name of [/^Publish to handbook/, /^Review & pull/]) {
      const item = within(menu).getByRole("menuitem", { name });
      expect(item.getAttribute("aria-disabled")).toBe("true");
      expect(item.getAttribute("title")).toBe("Handbook sync isn't set up");
      await user.click(item);
    }
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(actions.handbookPublishPreviewAction).not.toHaveBeenCalled();
    expect(actions.handbookPullPreviewAction).not.toHaveBeenCalled();
  });

  it("does not offer a second publish while a PR is open", async () => {
    const user = userEvent.setup();
    const pr = { number: 4, url: "https://github.com/Stockkart/engineering-handbook/pull/4" };
    render(<DocScreen {...props(sync("pr_open", { pr }))} />);
    await user.click(screen.getByRole("button", { name: "More actions for Runbook" }));
    const item = within(screen.getByRole("menu")).getByRole("menuitem", {
      name: /^Publish to handbook/,
    });
    expect(item.getAttribute("title")).toBe("A publish PR is already open");
    expect(within(header()).getByRole("link", { name: "PR open #4" })).toBeInTheDocument();
  });

  it("blocks a publish that looks like it holds a secret (no override) and shows the warning", async () => {
    const user = userEvent.setup();
    actions.handbookPublishPreviewAction.mockResolvedValue(
      preview({
        secret:
          "“Runbook” looks like an access token or API key. Remove it before publishing: the handbook repo is public.",
      }),
    );
    render(<DocScreen {...props(sync("changed_in_hq"))} />);
    await choose(user, /^Publish to handbook/);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(HANDBOOK_PUBLIC_WARNING)).toBeTruthy();
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    await user.click(within(dialog).getByRole("checkbox", { name: /fine for everyone/ }));
    expect(within(dialog).getByRole("button", { name: "Open pull request" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(actions.handbookPublishAction).not.toHaveBeenCalled();
  });

  it("asks to overwrite handbook changes and sends the reviewed blob", async () => {
    const user = userEvent.setup();
    actions.handbookPublishPreviewAction.mockResolvedValue(
      preview({
        needsOverwrite: true,
        remote: {
          sha: REMOTE,
          diff: [{ kind: "remove", text: "old", lines: 1, oldStart: 1, newStart: 1 }],
        },
      }),
    );
    actions.handbookPublishAction.mockResolvedValue({
      ok: true,
      data: {
        pr: { number: 3, url: "https://github.com/x/y/pull/3" },
        published: [],
        unchanged: [],
        refused: [],
      },
    });
    render(<DocScreen {...props(sync("both_changed"))} />);
    await choose(user, /^Publish to handbook/);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/Overwrite its changes/);
    // The shared diff renderer (the version history's).
    const changes = within(dialog).getByRole("list", { name: "Changes to RUNBOOK.md" });
    expect(within(changes).getByText("Removed:")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("checkbox", { name: /fine for everyone/ }));
    const open = within(dialog).getByRole("button", { name: "Open pull request" });
    expect(open).toHaveProperty("disabled", true);
    await user.click(within(dialog).getByRole("checkbox", { name: /Overwrite its changes/ }));
    await user.click(open);
    await waitFor(() =>
      expect(actions.handbookPublishAction).toHaveBeenCalledWith({
        projectKey: "STK",
        docIds: [DOC_ID],
        path: "RUNBOOK.md",
        overwrite: [{ docId: DOC_ID, remoteSha: REMOTE }],
        acknowledgedPublic: true,
        confirmSpecialPath: false,
        expectedVersion: 3,
      }),
    );
  });

  it("previews the doc's own path as the server resolves it now (after a rename)", async () => {
    const user = userEvent.setup();
    actions.handbookPublishPreviewAction.mockResolvedValue(preview({ path: "RENAMED.md" }));
    // The page loaded with the old title's path.
    render(<DocScreen {...props(sync("changed_in_hq", { path: "RUNBOOK.md" }))} />);
    await choose(user, /^Publish to handbook/);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Path in the repo")).toHaveValue("RENAMED.md"),
    );
    expect(actions.handbookPublishPreviewAction).toHaveBeenCalledWith({
      docId: DOC_ID,
      path: undefined,
    });
  });

  it("refuses an invalid path before asking the server", async () => {
    const user = userEvent.setup();
    actions.handbookPublishPreviewAction.mockResolvedValue(preview());
    render(<DocScreen {...props(sync("changed_in_hq"))} />);
    await choose(user, /^Publish to handbook/);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(actions.handbookPublishPreviewAction).toHaveBeenCalledTimes(1));
    const input = within(dialog).getByLabelText("Path in the repo");
    await user.clear(input);
    await user.type(input, "../outside.md");
    await user.click(within(dialog).getByRole("button", { name: "Check path" }));
    expect(await within(dialog).findByText(/Use a relative path/)).toBeTruthy();
    expect(actions.handbookPublishPreviewAction).toHaveBeenCalledTimes(1);
  });

  it("reviews a conflict: take the handbook version, or keep HQ's and go to publish", async () => {
    const user = userEvent.setup();
    actions.handbookPullPreviewAction.mockResolvedValue(pullPreview("both_changed"));
    actions.handbookPullApplyAction.mockResolvedValue({ ok: true, data: { version: 4 } });
    actions.handbookPublishPreviewAction.mockResolvedValue(preview());
    render(<DocScreen {...props(sync("both_changed"))} />);
    await choose(user, /^Review & pull/);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Both changed/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Take handbook version" }));
    await waitFor(() =>
      expect(actions.handbookPullApplyAction).toHaveBeenCalledWith({
        docId: DOC_ID,
        baseVersion: 3,
        remoteSha: REMOTE,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(router.refresh).toHaveBeenCalled();

    await choose(user, /^Review & pull/);
    const again = await screen.findByRole("dialog");
    await user.click(await within(again).findByRole("button", { name: "Keep HQ version" }));
    expect(await screen.findByRole("heading", { name: "Publish to handbook" })).toBeTruthy();
    await waitFor(() => expect(actions.handbookPublishPreviewAction).toHaveBeenCalledTimes(1));
  });
});

describe("handbook actions and edit mode (DOC-14)", () => {
  it("publish saves pending edits BEFORE the preview, so only saved content is exported", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    docActions.saveDocAction.mockImplementation(async (input: { baseVersion: number }) => {
      order.push(`save v${input.baseVersion}`);
      return { ok: true, data: { status: "saved", version: input.baseVersion + 1 } };
    });
    actions.handbookPublishPreviewAction.mockImplementation(async () => {
      order.push("preview");
      return preview();
    });
    at(`/STK/docs/${DOC_ID}?edit=1`);
    render(<DocScreen {...props(sync("changed_in_hq"))} />);
    await user.type(await screen.findByRole("textbox", { name: "Document" }), "Unsaved");
    await choose(user, /^Publish to handbook/);
    await waitFor(() => expect(order).toEqual(["save v3", "preview"]));
    expect(docActions.saveDocAction).toHaveBeenCalledWith(
      expect.objectContaining({ content: body("Unsaved") }),
    );
    // Still editing: publishing does not leave edit mode (the editor is behind the dialog).
    expect(window.location.search).toBe("?edit=1");
    expect(editorBox()).toBeInTheDocument();
  });

  it("publish says Save first (and asks nothing) when the pending edits could not be saved", async () => {
    const user = userEvent.setup();
    docActions.saveDocAction.mockResolvedValue({ ok: false, error: "Offline" });
    at(`/STK/docs/${DOC_ID}?edit=1`);
    render(<DocScreen {...props(sync("changed_in_hq"))} />);
    await user.type(await screen.findByRole("textbox", { name: "Document" }), "Unsaved");
    await choose(user, /^Publish to handbook/);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(SAVE_FIRST_MESSAGE)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Open pull request" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(dialog).getByRole("button", { name: "Check path" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(actions.handbookPublishPreviewAction).not.toHaveBeenCalled();
    expect(actions.handbookPublishAction).not.toHaveBeenCalled();
  });

  it("pull from edit mode saves, leaves edit mode, and shows the pulled version in read mode", async () => {
    const user = userEvent.setup();
    actions.handbookPullPreviewAction.mockResolvedValue(pullPreview("both_changed", 4));
    actions.handbookPullApplyAction.mockResolvedValue({ ok: true, data: { version: 5 } });
    at(`/STK/docs/${DOC_ID}?edit=1`);
    const view = render(<DocScreen {...props(sync("changed_in_handbook"))} />);
    await user.type(await screen.findByRole("textbox", { name: "Document" }), "Mine");
    await choose(user, /^Review & pull/);
    // "Done" first: my edit is saved (v4), then read mode; only then the preview.
    await waitFor(() => expect(actions.handbookPullPreviewAction).toHaveBeenCalledTimes(1));
    expect(docActions.saveDocAction).toHaveBeenCalledWith(
      expect.objectContaining({ baseVersion: 3, content: body("Mine") }),
    );
    expect(window.location.search).toBe("");
    expect(editorBox()).not.toBeInTheDocument();
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: "Take handbook version" }));
    await waitFor(() =>
      expect(actions.handbookPullApplyAction).toHaveBeenCalledWith({
        docId: DOC_ID,
        baseVersion: 4,
        remoteSha: REMOTE,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The refresh brings v5 (the pulled file): read mode shows it.
    view.rerender(
      <DocScreen
        {...props(sync("in_sync", { version: 5, syncedVersion: 5 }), {
          doc: docDetail({
            version: 5,
            content: body("Theirs from the handbook."),
            handbook: sync("in_sync", { version: 5, syncedVersion: 5 }),
          }),
        })}
      />,
    );
    expect(screen.getByText("Theirs from the handbook.")).toBeInTheDocument();
    expect(editorBox()).not.toBeInTheDocument();
    expect(within(header()).getByText("In sync")).toBeInTheDocument();
  });

  it("pull from edit mode stops when the person chooses to stay (save failed)", async () => {
    const user = userEvent.setup();
    docActions.saveDocAction.mockResolvedValue({ ok: false, error: "Offline" });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    at(`/STK/docs/${DOC_ID}?edit=1`);
    render(<DocScreen {...props(sync("changed_in_handbook"))} />);
    await user.type(await screen.findByRole("textbox", { name: "Document" }), "Mine");
    await choose(user, /^Review & pull/);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(window.location.search).toBe("?edit=1");
    expect(editorBox()).toBeInTheDocument();
    expect(actions.handbookPullPreviewAction).not.toHaveBeenCalled();
  });
});
