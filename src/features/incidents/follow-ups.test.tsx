// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cross-slice: INC-2 "Create follow-up issue" goes through the app-wide quick create, which
 * the releases slice extended with a fix version (REL-1). Both are rendered together here,
 * as the top bar and the incident page are in the app.
 */

const issueActions = vi.hoisted(() => ({
  createIssueAction: vi.fn(),
  loadIssueTemplatesAction: vi.fn(),
}));
vi.mock("@/server/actions/issues", () => issueActions);

const todoActions = vi.hoisted(() => ({ promoteTodoAction: vi.fn() }));
vi.mock("@/server/actions/todos", () => todoActions);

const releaseActions = vi.hoisted(() => ({ loadReleaseOptionsAction: vi.fn() }));
vi.mock("@/server/actions/releases", () => releaseActions);

const incidentActions = vi.hoisted(() => ({
  linkFollowUpAction: vi.fn(),
  unlinkFollowUpAction: vi.fn(),
}));
vi.mock("@/server/actions/incidents", () => incidentActions);

vi.mock("@/server/actions/search", () => ({ searchAction: vi.fn() }));

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/STK/incidents/3",
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

vi.mock("@/features/editor/lazy-rich-text-editor", () => ({
  preloadRichTextEditor: () => Promise.resolve(),
  LazyRichTextEditor: ({ label }: { label: string }) => <div aria-label={label} />,
}));

const { QuickCreate } = await import("@/features/issue/quick-create");
const { FollowUps } = await import("./follow-ups");

const INCIDENT_ID = "5b1e0a52-7c1d-4f3e-9a2b-6c7d8e9f0a1b";
const RELEASE_ID = "0f1e2d3c-4b5a-4968-8776-5544332211aa";

describe("FollowUps × QuickCreate (INC-2 with REL-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issueActions.loadIssueTemplatesAction.mockResolvedValue({ ok: true, data: {} });
    issueActions.createIssueAction.mockResolvedValue({
      ok: true,
      data: { id: "x", number: 12, key: "STK-12" },
    });
    releaseActions.loadReleaseOptionsAction.mockResolvedValue({
      ok: true,
      data: [{ id: RELEASE_ID, name: "api-v1.4", state: "unreleased" }],
    });
    incidentActions.linkFollowUpAction.mockResolvedValue({ ok: true, data: undefined });
  });

  it("pre-fills the follow-up, creates it with a fix version and links it", async () => {
    const user = userEvent.setup();
    render(
      <>
        <QuickCreate defaultProjectKey="STK" />
        <FollowUps
          incidentId={INCIDENT_ID}
          incidentKey="INC-3"
          incidentTitle="Checkout API down"
          followUps={[]}
        />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Create follow-up issue" }));

    expect(await screen.findByLabelText("Title")).toHaveValue("Follow-up INC-3: Checkout API down");
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent("Task");
    expect(releaseActions.loadReleaseOptionsAction).toHaveBeenCalledWith({ projectKey: "STK" });
    await user.click(screen.getByRole("combobox", { name: "Fix version" }));
    await user.click(await screen.findByRole("option", { name: "api-v1.4" }));
    await user.click(screen.getByRole("button", { name: "Create issue" }));

    await waitFor(() =>
      expect(issueActions.createIssueAction).toHaveBeenCalledWith(
        expect.objectContaining({
          projectKey: "STK",
          title: "Follow-up INC-3: Checkout API down",
          type: "task",
          releaseId: RELEASE_ID,
        }),
      ),
    );
    await waitFor(() =>
      expect(incidentActions.linkFollowUpAction).toHaveBeenCalledWith({
        incidentId: INCIDENT_ID,
        issueKey: "STK-12",
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("STK-12 linked as a follow-up"));
  });

  it("creates a follow-up without a fix version when none is picked", async () => {
    const user = userEvent.setup();
    render(
      <>
        <QuickCreate defaultProjectKey="STK" />
        <FollowUps
          incidentId={INCIDENT_ID}
          incidentKey="INC-3"
          incidentTitle="Checkout API down"
          followUps={[]}
        />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Create follow-up issue" }));
    await screen.findByLabelText("Title");
    expect(screen.getByRole("combobox", { name: "Fix version" })).toHaveTextContent("None");
    await user.click(screen.getByRole("button", { name: "Create issue" }));

    await waitFor(() => expect(issueActions.createIssueAction).toHaveBeenCalledTimes(1));
    expect(issueActions.createIssueAction.mock.calls[0]?.[0]).not.toHaveProperty("releaseId");
    await waitFor(() => expect(incidentActions.linkFollowUpAction).toHaveBeenCalledTimes(1));
  });
});
