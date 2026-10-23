import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceError } from "@/server/services/errors";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const issueService = vi.hoisted(() => ({
  createIssue: vi.fn(),
  updateIssueField: vi.fn(),
  addLabel: vi.fn(),
  removeLabel: vi.fn(),
  addLink: vi.fn(),
  removeLink: vi.fn(),
  deleteIssue: vi.fn(),
  cloneIssue: vi.fn(),
  convertIssueType: vi.fn(),
}));
const commentService = vi.hoisted(() => ({
  createComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
}));
const issueQueries = vi.hoisted(() => ({ issueTemplates: vi.fn() }));
vi.mock("@/server/services", () => ({ issueService, commentService, issueQueries }));

const actions = await import("./issues");
const { UnauthorizedError } = await import("@/server/auth/require-session");

const ID = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const session: Session = {
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: ID, name: "Test Staff", email: "staff@example.test" },
};
const doc = { type: "doc", content: [{ type: "paragraph" }] };

/** One valid input per action, so every action is exercised in each test below. */
const validInputs: [Exclude<keyof typeof actions, "loadIssueTemplatesAction">, unknown][] = [
  ["createIssueAction", { projectKey: "STK", title: "x" }],
  ["updateIssueFieldAction", { issueId: ID, field: "priority", value: 1 }],
  ["addLabelAction", { issueId: ID, name: "ocr" }],
  ["removeLabelAction", { issueId: ID, labelId: ID }],
  ["addLinkAction", { issueId: ID, relation: "blocks", targetKey: "STK-1" }],
  ["removeLinkAction", { issueId: ID, linkId: ID }],
  ["deleteIssueAction", { issueId: ID }],
  ["createCommentAction", { issueId: ID, body: doc }],
  ["editCommentAction", { commentId: ID, body: doc }],
  ["deleteCommentAction", { commentId: ID }],
  ["cloneIssueAction", { issueId: ID }],
  ["convertIssueTypeAction", { issueId: ID, type: "bug" }],
];

const allMocks = () => [...Object.values(issueService), ...Object.values(commentService)];

describe("issue server actions", () => {
  beforeEach(() => {
    authMock.mockReset();
    for (const mock of allMocks()) mock.mockReset().mockResolvedValue({});
  });

  it.each(validInputs)("%s refuses without a session and touches nothing", async (name, input) => {
    authMock.mockResolvedValue(null);
    await expect(actions[name](input)).rejects.toBeInstanceOf(UnauthorizedError);
    for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
  });

  it.each(validInputs)("%s calls its service as the session user", async (name, input) => {
    authMock.mockResolvedValue(session);
    await expect(actions[name](input)).resolves.toMatchObject({ ok: true });
    const called = allMocks().filter((mock) => mock.mock.calls.length > 0);
    expect(called).toHaveLength(1);
    expect(called[0]?.mock.calls[0]?.[0]).toBe(ID);
  });

  it.each(validInputs)("%s rejects malformed input before the service", async (name) => {
    authMock.mockResolvedValue(session);
    await expect(actions[name]({ issueId: "nope", commentId: 1 })).resolves.toMatchObject({
      ok: false,
    });
    for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
  });

  it("turns expected service failures into { ok: false, error }", async () => {
    authMock.mockResolvedValue(session);
    issueService.updateIssueField.mockRejectedValue(
      new ServiceError("invalid", "A subtask needs a parent issue"),
    );
    await expect(
      actions.updateIssueFieldAction({ issueId: ID, field: "parent", value: null }),
    ).resolves.toEqual({ ok: false, error: "A subtask needs a parent issue" });
  });

  it("lets unexpected errors propagate", async () => {
    authMock.mockResolvedValue(session);
    issueService.deleteIssue.mockRejectedValue(new Error("boom"));
    await expect(actions.deleteIssueAction({ issueId: ID })).rejects.toThrow("boom");
  });

  it.each(validInputs)(
    "%s refreshes only issue/doc pages, never the whole project subtree",
    async (name, input) => {
      authMock.mockResolvedValue(session);
      revalidatePath.mockReset();
      await actions[name](input);
      expect(revalidatePath).toHaveBeenCalled();
      for (const [path, type] of revalidatePath.mock.calls) {
        expect(type).toBe("page");
        // Sprint pages show tallies and burndowns of issue fields (SPR-1…3); the roadmap
        // shows epics' fields, dates and links (RDM-1/2); release pages show the progress
        // of their fix versions (REL-1); an incident page lists its follow-ups (INC-2).
        expect(path).toMatch(
          /^\/(\[projectKey\]\/(issues|backlog|board|adrs|docs\/\[id\]|sprints|roadmap|releases|incidents\/\[key\])|my-work|todos)/,
        );
        expect(path).not.toBe("/[projectKey]");
      }
    },
  );

  it("refreshes an incident page (its follow-ups) on field changes and deletes", async () => {
    authMock.mockResolvedValue(session);
    for (const call of [
      () => actions.updateIssueFieldAction({ issueId: ID, field: "priority", value: 1 }),
      () => actions.deleteIssueAction({ issueId: ID }),
    ]) {
      revalidatePath.mockReset();
      await call();
      expect(revalidatePath).toHaveBeenCalledWith("/[projectKey]/incidents/[key]", "page");
    }
  });

  it("refreshes the issue page and the roadmap (RDM-2 arrows) for links", async () => {
    authMock.mockResolvedValue(session);
    revalidatePath.mockReset();
    await actions.addLinkAction({ issueId: ID, relation: "blocks", targetKey: "STK-1" });
    expect(revalidatePath.mock.calls).toEqual([
      ["/[projectKey]/issues/[key]", "page"],
      ["/[projectKey]/roadmap", "page"],
    ]);
  });

  it("refreshes just the issue page for comments", async () => {
    authMock.mockResolvedValue(session);
    revalidatePath.mockReset();
    await actions.createCommentAction({ issueId: ID, body: { type: "doc", content: [] } });
    expect(revalidatePath.mock.calls).toEqual([["/[projectKey]/issues/[key]", "page"]]);
  });

  it("saves a roadmap schedule (RDM-1) and refuses an end before the start", async () => {
    authMock.mockResolvedValue(session);
    const value = { startDate: "2026-06-01", dueDate: "2026-06-14" };
    await expect(
      actions.updateIssueFieldAction({ issueId: ID, field: "schedule", value }),
    ).resolves.toMatchObject({ ok: true });
    expect(issueService.updateIssueField).toHaveBeenCalledWith(ID, {
      issueId: ID,
      field: "schedule",
      value,
    });
    issueService.updateIssueField.mockClear();
    await expect(
      actions.updateIssueFieldAction({
        issueId: ID,
        field: "schedule",
        value: { startDate: "2026-06-14", dueDate: "2026-06-01" },
      }),
    ).resolves.toEqual({ ok: false, error: "The end date is before the start date" });
    expect(issueService.updateIssueField).not.toHaveBeenCalled();
  });

  it("refuses an unknown type to convert to (ISS-14)", async () => {
    authMock.mockResolvedValue(session);
    await expect(
      actions.convertIssueTypeAction({ issueId: ID, type: "saga" }),
    ).resolves.toMatchObject({ ok: false });
    expect(issueService.convertIssueType).not.toHaveBeenCalled();
  });

  it("does not refresh anything when the input is rejected", async () => {
    authMock.mockResolvedValue(session);
    revalidatePath.mockReset();
    await actions.updateIssueFieldAction({ issueId: "nope" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("loads issue templates only with a session", async () => {
    issueQueries.issueTemplates.mockReset().mockResolvedValue({ bug: doc });
    authMock.mockResolvedValue(null);
    await expect(actions.loadIssueTemplatesAction()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(issueQueries.issueTemplates).not.toHaveBeenCalled();
    authMock.mockResolvedValue(session);
    await expect(actions.loadIssueTemplatesAction()).resolves.toEqual({
      ok: true,
      data: { bug: doc },
    });
  });
});
