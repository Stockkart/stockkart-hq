// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HANDBOOK_PUBLIC_WARNING } from "@/lib/handbook/constants";
import { type HandbookDocSync, type HandbookPublicationView } from "@/lib/handbook/views";

const actions = vi.hoisted(() => ({
  handbookCheckAction: vi.fn(),
  handbookImportFileAction: vi.fn(),
  handbookPublishAction: vi.fn(),
  handbookPublishPreviewAction: vi.fn(),
  handbookPullPreviewAction: vi.fn(),
  handbookPullApplyAction: vi.fn(),
  handbookTestConnectionAction: vi.fn(),
}));
vi.mock("@/server/actions/handbook", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { HandbookTab } = await import("./handbook-tab");

const id = (n: number) => `7d1a2c4e-1f3b-4c5d-8e9f-${String(n).padStart(12, "0")}`;
const doc = (n: number, title: string, status: HandbookDocSync["status"]): HandbookDocSync => ({
  docId: id(n),
  title,
  type: "page",
  path: `${title.toUpperCase()}.md`,
  status,
  version: 2,
  syncedVersion: null,
  syncedAt: null,
  remoteSeenAt: null,
  pr:
    status === "pr_open"
      ? { number: 7, url: "https://github.com/Stockkart/engineering-handbook/pull/7" }
      : null,
});
const docs = [
  doc(1, "Runbook", "changed_in_hq"),
  doc(2, "Design", "changed_in_handbook"),
  doc(3, "Fresh", "not_in_handbook"),
  doc(4, "Pending", "pr_open"),
];
const publications: HandbookPublicationView[] = [
  {
    id: id(9),
    branch: "hq/publish-20260501-abcd1234",
    state: "merged",
    prNumber: 7,
    prUrl: "https://github.com/Stockkart/engineering-handbook/pull/7",
    errorCode: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    mergedAt: new Date("2026-05-02T00:00:00Z"),
    createdByName: "Ada",
    docCount: 2,
  },
];
const config = {
  configured: true,
  repo: "Stockkart/engineering-handbook",
  repoUrl: "https://github.com/Stockkart/engineering-handbook",
};

describe("Settings → Handbook tab (DOC-14)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the setup steps and disables writes when the App is not configured", () => {
    render(
      <HandbookTab
        projectKey="STK"
        config={{ ...config, configured: false }}
        docs={docs}
        publications={[]}
      />,
    );
    expect(screen.getByText("Handbook sync isn't set up")).toBeTruthy();
    expect(screen.getByText(/Permissions: Contents read & write/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check handbook now" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: /Publish selected/ })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("lists docs with their status, filters them and links recent publications", async () => {
    const user = userEvent.setup();
    render(
      <HandbookTab projectKey="STK" config={config} docs={docs} publications={publications} />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(5);
    expect(within(table).getByText("PR open #7").closest("a")?.getAttribute("href")).toBe(
      "https://github.com/Stockkart/engineering-handbook/pull/7",
    );
    await user.click(screen.getByRole("button", { name: "Changed in HQ" }));
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByText("Runbook")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Not published" }));
    expect(within(table).getByText("Fresh")).toBeTruthy();
    expect(screen.getByRole("link", { name: "PR #7" }).getAttribute("href")).toBe(
      "https://github.com/Stockkart/engineering-handbook/pull/7",
    );
  });

  it("publishes the selection in one PR after the public warning is acknowledged", async () => {
    const user = userEvent.setup();
    actions.handbookPublishAction.mockResolvedValue({
      ok: true,
      data: {
        pr: { number: 12, url: "https://github.com/Stockkart/engineering-handbook/pull/12" },
        published: [{ docId: id(1), title: "Runbook", path: "RUNBOOK.md" }],
        unchanged: [],
        refused: [
          {
            docId: id(2),
            title: "Design",
            reason: "Changed in the handbook since your last sync: pull first",
          },
        ],
      },
    });
    render(<HandbookTab projectKey="STK" config={config} docs={docs} publications={[]} />);
    expect(screen.getByRole("checkbox", { name: "Select Pending" })).toHaveProperty(
      "disabled",
      true,
    );
    await user.click(screen.getByRole("checkbox", { name: "Select Runbook" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Design" }));
    await user.click(screen.getByRole("button", { name: "Publish selected (2)" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(HANDBOOK_PUBLIC_WARNING)).toBeTruthy();
    const open = within(dialog).getByRole("button", { name: "Open pull request" });
    expect(open).toHaveProperty("disabled", true);
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(open);
    await waitFor(() => expect(actions.handbookPublishAction).toHaveBeenCalledTimes(1));
    expect(actions.handbookPublishAction).toHaveBeenCalledWith({
      projectKey: "STK",
      docIds: [id(1), id(2)],
      acknowledgedPublic: true,
    });
    expect(
      await screen.findByText(/Opened PR #12 with 1 docs\. Design: Changed in the handbook/),
    ).toBeTruthy();
  });

  it("checks the handbook on demand and imports new files", async () => {
    const user = userEvent.setup();
    actions.handbookCheckAction.mockResolvedValue({
      ok: true,
      data: { checked: 3, drifted: 1, newFiles: [{ path: "NEW_GUIDE.md", sha: "a".repeat(40) }] },
    });
    actions.handbookImportFileAction.mockResolvedValue({ ok: true, data: { id: id(5) } });
    render(<HandbookTab projectKey="STK" config={config} docs={docs} publications={[]} />);
    // Nothing is asked of GitHub while rendering.
    expect(actions.handbookCheckAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Check handbook now" }));
    expect(await screen.findByText("NEW_GUIDE.md")).toBeTruthy();
    expect(screen.getByText(/Checked 3 docs: 1 changed in the handbook, 1 new files/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(actions.handbookImportFileAction).toHaveBeenCalledWith({
        projectKey: "STK",
        path: "NEW_GUIDE.md",
      }),
    );
    expect(await screen.findByRole("button", { name: "Imported" })).toBeTruthy();
  });

  it("tests the connection on click and shows ✓ or the classified reason", async () => {
    const user = userEvent.setup();
    actions.handbookTestConnectionAction
      .mockResolvedValueOnce({
        ok: true,
        data: { repo: "Stockkart/engineering-handbook", defaultBranch: "main" },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: "The GitHub App can't get access to … (installation_token.422).",
      });
    render(<HandbookTab projectKey="STK" config={config} docs={docs} publications={[]} />);
    expect(actions.handbookTestConnectionAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(
      await screen.findByText(
        "✓ Connected to Stockkart/engineering-handbook (default branch main).",
      ),
    ).toBeTruthy();
    expect(actions.handbookTestConnectionAction).toHaveBeenCalledWith({ projectKey: "STK" });
    expect(toast.success).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/installation_token\.422/)).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith(
      "The GitHub App can't get access to … (installation_token.422).",
    );
  });

  it("offers no connection test until the App is configured", () => {
    render(
      <HandbookTab
        projectKey="STK"
        config={{ ...config, configured: false }}
        docs={docs}
        publications={[]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull();
  });

  it("shows a failed publication's reason, also for old github_<status> codes", () => {
    const failed = (n: number, errorCode: string): HandbookPublicationView => ({
      id: id(n),
      branch: `hq/publish-20260501-${n}`,
      state: "failed",
      prNumber: null,
      prUrl: null,
      errorCode,
      createdAt: new Date("2026-05-01T00:00:00Z"),
      mergedAt: null,
      createdByName: "Ada",
      docCount: 1,
    });
    render(
      <HandbookTab
        projectKey="STK"
        config={config}
        docs={docs}
        publications={[failed(10, "installation_token.422"), failed(11, "github_422")]}
      />,
    );
    expect(
      screen.getByText(
        /^The GitHub App can't get access to Stockkart\/engineering-handbook\..*\(installation_token\.422\)\.$/,
      ),
    ).toBeTruthy();
    expect(screen.getByText("GitHub refused a request (HTTP 422) (github_422).")).toBeTruthy();
  });
});
