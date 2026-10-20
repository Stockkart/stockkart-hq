import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceError } from "@/server/services/errors";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const docService = vi.hoisted(() => ({
  createDoc: vi.fn(),
  createAdr: vi.fn(),
  saveDoc: vi.fn(),
  renameDoc: vi.fn(),
  updateMeta: vi.fn(),
  moveDoc: vi.fn(),
  deleteDoc: vi.fn(),
  linkIssue: vi.fn(),
  unlinkIssue: vi.fn(),
}));
const docQueries = vi.hoisted(() => ({ docTemplates: vi.fn() }));
vi.mock("@/server/services", () => ({ docService, docQueries }));

const actions = await import("./docs");
const { UnauthorizedError } = await import("@/server/auth/require-session");

const ID = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const session: Session = {
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: ID, name: "Test Staff", email: "staff@example.test" },
};
const doc = { type: "doc", content: [{ type: "paragraph" }] };

/** One valid input per action, so every action is exercised in each test below. */
const validInputs: [Exclude<keyof typeof actions, "loadDocTemplatesAction">, unknown][] = [
  ["createDocAction", { projectKey: "STK", title: "Runbook" }],
  ["createAdrAction", { projectKey: "STK", title: "Use Postgres" }],
  ["saveDocAction", { docId: ID, baseVersion: 3, content: doc }],
  ["renameDocAction", { docId: ID, title: "New" }],
  ["updateDocMetaAction", { docId: ID, field: "status", value: "approved" }],
  ["moveDocAction", { docId: ID, parentId: null, index: 0 }],
  ["deleteDocAction", { docId: ID }],
  ["linkDocIssueAction", { docId: ID, issueKey: "STK-1" }],
  ["unlinkDocIssueAction", { docId: ID, linkId: ID }],
];

const allMocks = () => Object.values(docService);

describe("doc server actions", () => {
  beforeEach(() => {
    authMock.mockReset();
    revalidatePath.mockReset();
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
    await expect(actions[name]({ docId: "nope", projectKey: 1 })).resolves.toMatchObject({
      ok: false,
    });
    for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
  });

  it("does not revalidate on autosave, but does after other changes", async () => {
    authMock.mockResolvedValue(session);
    await actions.saveDocAction({ docId: ID, baseVersion: 1, content: doc });
    expect(revalidatePath).not.toHaveBeenCalled();
    await actions.renameDocAction({ docId: ID, title: "x" });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("rejects a non-positive base version and turning a doc into an ADR", async () => {
    authMock.mockResolvedValue(session);
    await expect(
      actions.saveDocAction({ docId: ID, baseVersion: 0, content: doc }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      actions.updateDocMetaAction({ docId: ID, field: "type", value: "adr" }),
    ).resolves.toMatchObject({ ok: false });
    expect(docService.saveDoc).not.toHaveBeenCalled();
    expect(docService.updateMeta).not.toHaveBeenCalled();
  });

  it("turns expected service failures into { ok: false, error }", async () => {
    authMock.mockResolvedValue(session);
    docService.moveDoc.mockRejectedValue(
      new ServiceError("invalid", "A doc cannot be moved under one of its own sub-pages"),
    );
    await expect(actions.moveDocAction({ docId: ID, parentId: ID, index: 0 })).resolves.toEqual({
      ok: false,
      error: "A doc cannot be moved under one of its own sub-pages",
    });
  });

  it("lets unexpected errors propagate", async () => {
    authMock.mockResolvedValue(session);
    docService.deleteDoc.mockRejectedValue(new Error("boom"));
    await expect(actions.deleteDocAction({ docId: ID })).rejects.toThrow("boom");
  });

  it("loads doc templates only with a session", async () => {
    docQueries.docTemplates.mockReset().mockResolvedValue([]);
    authMock.mockResolvedValue(null);
    await expect(actions.loadDocTemplatesAction()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(docQueries.docTemplates).not.toHaveBeenCalled();
    authMock.mockResolvedValue(session);
    await expect(actions.loadDocTemplatesAction()).resolves.toEqual({ ok: true, data: [] });
  });
});
