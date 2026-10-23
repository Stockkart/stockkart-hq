// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HANDBOOK_PUBLIC_WARNING } from "@/lib/handbook/constants";
import { type HandbookDocSync } from "@/lib/handbook/views";

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
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const { HandbookActions } = await import("./handbook-actions");
const { HandbookStatusBadge } = await import("./handbook-status-badge");

const DOC = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const REMOTE = "b".repeat(40);
const sync = (status: HandbookDocSync["status"]): HandbookDocSync => ({
  docId: DOC,
  title: "Runbook",
  type: "page",
  path: "RUNBOOK.md",
  status,
  version: 3,
  syncedVersion: 2,
  syncedAt: null,
  remoteSeenAt: null,
  pr: null,
});
const preview = (patch: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    docId: DOC,
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

describe("handbook doc actions (DOC-14)", () => {
  beforeEach(() => vi.clearAllMocks());

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

  it("disables both actions with the reason when the App is not configured", () => {
    render(<HandbookActions projectKey="STK" sync={sync("both_changed")} configured={false} />);
    for (const name of ["Publish to handbook", "Review & pull"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveProperty("disabled", true);
      expect(button.getAttribute("title")).toBe("Handbook sync isn't set up");
    }
  });

  it("blocks a publish that looks like it holds a secret (no override) and shows the warning", async () => {
    const user = userEvent.setup();
    actions.handbookPublishPreviewAction.mockResolvedValue(
      preview({
        secret:
          "“Runbook” looks like an access token or API key. Remove it before publishing: the handbook repo is public.",
      }),
    );
    render(<HandbookActions projectKey="STK" sync={sync("changed_in_hq")} configured />);
    await user.click(screen.getByRole("button", { name: "Publish to handbook" }));
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
    render(<HandbookActions projectKey="STK" sync={sync("both_changed")} configured />);
    await user.click(screen.getByRole("button", { name: "Publish to handbook" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/Overwrite its changes/);
    await user.click(within(dialog).getByRole("checkbox", { name: /fine for everyone/ }));
    const open = within(dialog).getByRole("button", { name: "Open pull request" });
    expect(open).toHaveProperty("disabled", true);
    await user.click(within(dialog).getByRole("checkbox", { name: /Overwrite its changes/ }));
    await user.click(open);
    await waitFor(() =>
      expect(actions.handbookPublishAction).toHaveBeenCalledWith({
        projectKey: "STK",
        docIds: [DOC],
        path: "RUNBOOK.md",
        overwrite: [{ docId: DOC, remoteSha: REMOTE }],
      }),
    );
  });

  it("refuses an invalid path before asking the server", async () => {
    const user = userEvent.setup();
    actions.handbookPublishPreviewAction.mockResolvedValue(preview());
    render(<HandbookActions projectKey="STK" sync={sync("changed_in_hq")} configured />);
    await user.click(screen.getByRole("button", { name: "Publish to handbook" }));
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
    actions.handbookPullPreviewAction.mockResolvedValue({
      ok: true,
      data: {
        docId: DOC,
        path: "RUNBOOK.md",
        state: "both_changed",
        baseVersion: 3,
        remoteSha: REMOTE,
        diff: [{ kind: "add", text: "theirs", lines: 1, oldStart: 1, newStart: 1 }],
      },
    });
    actions.handbookPullApplyAction.mockResolvedValue({ ok: true, data: { version: 4 } });
    actions.handbookPublishPreviewAction.mockResolvedValue(preview());
    render(<HandbookActions projectKey="STK" sync={sync("both_changed")} configured />);
    await user.click(screen.getByRole("button", { name: "Review & pull" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Both changed/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Take handbook version" }));
    await waitFor(() =>
      expect(actions.handbookPullApplyAction).toHaveBeenCalledWith({
        docId: DOC,
        baseVersion: 3,
        remoteSha: REMOTE,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Review & pull" }));
    const again = await screen.findByRole("dialog");
    await user.click(await within(again).findByRole("button", { name: "Keep HQ version" }));
    expect(await screen.findByRole("heading", { name: "Publish to handbook" })).toBeTruthy();
  });
});
