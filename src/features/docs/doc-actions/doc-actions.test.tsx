// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type RichTextDoc } from "@/lib/rich-text";
import { body, DOC_ID, docDetail, treeItem, USER_ID } from "@/test/doc-fixtures";

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
vi.mock("@/server/actions/handbook", () => ({
  handbookPublishPreviewAction: vi.fn(),
  handbookPublishAction: vi.fn(),
  handbookPullPreviewAction: vi.fn(),
  handbookPullApplyAction: vi.fn(),
}));
vi.mock("@/features/editor/lazy-rich-text-editor", () => ({
  LazyRichTextEditor: ({ label }: { label: string; onChange?: (doc: RichTextDoc) => void }) => (
    <label>
      {label}
      <textarea />
    </label>
  ),
  preloadRichTextEditor: vi.fn(),
}));

const { DocScreen } = await import("../doc-screen");
const { DOC_ACTIONS } = await import("./index");
const { DOC_HEADER_BADGES } = await import("../doc-header-badges");

type Props = Parameters<typeof DocScreen>[0];

function props(patch: Partial<Props> = {}): Props {
  return {
    doc: docDetail(),
    ancestors: [],
    projectKeys: ["STK"],
    users: [{ id: USER_ID, name: "Ada", email: "ada@example.test" }],
    adrs: [],
    supersedes: [],
    linkedIssues: [],
    versions: [
      { version: 3, authorName: "Ada", createdAt: new Date("2026-01-03T10:00:00Z") },
      { version: 2, authorName: "Bo", createdAt: new Date("2026-01-02T10:00:00Z") },
    ],
    tree: [treeItem(DOC_ID, "Runbook")],
    comments: { threads: [], currentUser: { id: USER_ID, name: "Ada" } },
    ...patch,
  };
}

const adr = (patch: Parameters<typeof docDetail>[0] = {}) =>
  docDetail({
    type: "adr",
    title: "0007. Use cron",
    adrNumber: 7,
    adrStatus: "accepted",
    ...patch,
  });

async function openMenu(user: ReturnType<typeof userEvent.setup>, title = "Runbook") {
  await user.click(screen.getByRole("button", { name: `More actions for ${title}` }));
  return screen.getByRole("menu");
}

beforeEach(() => {
  window.history.replaceState(null, "", `/STK/docs/${DOC_ID}`);
  for (const mock of Object.values(docActions)) mock.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
});

describe("registries", () => {
  it("have unique ids (a second registration throws at load)", () => {
    const ids = DOC_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DOC_HEADER_BADGES.map((badge) => badge.id)).toEqual(["adr-status", "handbook-sync"]);
    // The handbook sync slice's two entries sit right above Delete.
    expect(ids.slice(-3)).toEqual(["handbook-publish", "handbook-pull", "delete"]);
  });
});

describe("export (DOC-12)", () => {
  it("Download as Markdown hits the export route", async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<DocScreen {...props()} />);
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Download as Markdown" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const link = click.mock.contexts[0];
    expect(link).toBeInstanceOf(HTMLAnchorElement);
    expect((link as HTMLAnchorElement).getAttribute("href")).toBe(`/STK/docs/${DOC_ID}/export`);
    expect((link as HTMLAnchorElement).hasAttribute("download")).toBe(true);
  });

  it("Copy as Markdown puts the export's Markdown on the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<DocScreen {...props({ doc: docDetail({ content: body("Hello **world**") }) })} />);
    const menu = await openMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "Copy as Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const markdown = String(writeText.mock.calls[0]?.[0]);
    expect(markdown.startsWith("# Runbook\n")).toBe(true);
    expect(markdown).toContain("Hello");
  });
});

describe("supersede (ADR-3)", () => {
  it("creates the successor from a small dialog and opens it in edit mode", async () => {
    const user = userEvent.setup();
    docActions.supersedeAdrAction.mockResolvedValue({
      ok: true,
      data: { id: "new-adr", title: "0012. Use a queue", version: 1, number: 12 },
    });
    render(<DocScreen {...props({ doc: adr() })} />);
    const menu = await openMenu(user, "0007. Use cron");
    await user.click(within(menu).getByRole("menuitem", { name: "Supersede with new ADR…" }));
    const dialog = await screen.findByRole("dialog", { name: "Supersede ADR-0007" });
    await user.type(within(dialog).getByLabelText("New decision title"), "Use a queue");
    await user.click(within(dialog).getByRole("button", { name: "Create and supersede" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/STK/docs/new-adr?edit=1"));
    expect(docActions.supersedeAdrAction).toHaveBeenCalledWith({
      docId: DOC_ID,
      title: "Use a queue",
    });
  });

  it("is blocked once superseded: the menu links to the successor instead", async () => {
    const user = userEvent.setup();
    render(
      <DocScreen
        {...props({
          doc: adr({
            adrStatus: "superseded",
            adrSupersededBy: { id: "succ", title: "0009. Use a queue" },
          }),
        })}
      />,
    );
    const menu = await openMenu(user, "0007. Use cron");
    expect(within(menu).queryByRole("menuitem", { name: "Supersede with new ADR…" })).toBeNull();
    await user.click(
      within(menu).getByRole("menuitem", { name: "Superseded by ADR-0009: open it" }),
    );
    expect(router.push).toHaveBeenCalledWith("/STK/docs/succ");
  });

  it("is not offered for pages", async () => {
    const user = userEvent.setup();
    render(<DocScreen {...props()} />);
    const menu = await openMenu(user);
    expect(within(menu).queryByRole("menuitem", { name: /Supersede/ })).toBeNull();
  });
});

describe("history: restore (DOC-10)", () => {
  async function restoreV2(user: ReturnType<typeof userEvent.setup>) {
    docActions.loadDocVersionAction.mockResolvedValue({
      ok: true,
      data: {
        version: 2,
        title: "Old runbook",
        content: body("Old text."),
        authorName: "Bo",
        createdAt: new Date("2026-01-02T10:00:00Z"),
      },
    });
    await user.click(screen.getByRole("button", { name: "History" }));
    await user.click(screen.getByRole("button", { name: /v2/ }));
    const dialog = await screen.findByRole("dialog", { name: "Version 2" });
    // The diff against the current version, with +/− labels.
    const changes = await within(dialog).findByRole("list", {
      name: "Changes from v2 to the current version (v3)",
    });
    expect(within(changes).getAllByText(/Removed:/).length).toBeGreaterThan(0);
    expect(within(changes).getByText("Old text.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Restore this version" }));
    // Confirm first.
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Restore v2?");
    await user.click(within(dialog).getByRole("button", { name: "Restore v2" }));
    return dialog;
  }

  it("restores as a new version after a confirmation", async () => {
    const user = userEvent.setup();
    docActions.restoreDocVersionAction.mockResolvedValue({
      ok: true,
      data: { status: "saved", version: 4, snapshotted: true },
    });
    render(<DocScreen {...props()} />);
    await restoreV2(user);
    await waitFor(() =>
      expect(docActions.restoreDocVersionAction).toHaveBeenCalledWith({
        docId: DOC_ID,
        version: 2,
        baseVersion: 3,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Version 2" })).toBeNull());
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows the conflict banner when someone saved meanwhile", async () => {
    const user = userEvent.setup();
    docActions.restoreDocVersionAction.mockResolvedValue({
      ok: true,
      data: {
        status: "conflict",
        latest: {
          version: 5,
          title: "Runbook",
          content: null,
          updatedByName: "Bo",
          updatedAt: new Date(),
        },
      },
    });
    render(<DocScreen {...props()} />);
    await restoreV2(user);
    // The dialog closes by itself, so the banner is seen.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Version 2" })).toBeNull());
    const banner = await screen.findByText(/Not restored: Bo saved v5/);
    expect(banner.closest("[role=alert]")).not.toBeNull();
    // "Restore anyway" retries on the winner's version (still a locked write).
    docActions.restoreDocVersionAction.mockResolvedValue({
      ok: true,
      data: { status: "saved", version: 6, snapshotted: true },
    });
    await user.click(screen.getByRole("button", { name: "Restore v2 anyway" }));
    await waitFor(() =>
      expect(docActions.restoreDocVersionAction).toHaveBeenLastCalledWith({
        docId: DOC_ID,
        version: 2,
        baseVersion: 5,
      }),
    );
    await waitFor(() => expect(screen.queryByText(/Not restored/)).toBeNull());
  });
});
