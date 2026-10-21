import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceError } from "@/server/services/errors";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const diagramService = vi.hoisted(() => ({
  createDiagram: vi.fn(),
  saveDiagram: vi.fn(),
  renameDiagram: vi.fn(),
  deleteDiagram: vi.fn(),
  moveDiagram: vi.fn(),
  restoreVersion: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
  requestThumbnailUpload: vi.fn(),
  confirmThumbnail: vi.fn(),
}));
const diagramQueries = vi.hoisted(() => ({
  getVersion: vi.fn(),
  diagramTemplates: vi.fn(),
  diagramOptions: vi.fn(),
  docOptions: vi.fn(),
}));
vi.mock("@/server/services", () => ({ diagramService, diagramQueries }));

const actions = await import("./diagrams");
const { UnauthorizedError } = await import("@/server/auth/require-session");

const ID = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const session: Session = {
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: ID, name: "Test Staff", email: "staff@example.test" },
};
const scene = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };

type ActionName = keyof typeof actions;

/** Actions that call a service as the session user, with one valid input each. */
const serviceActions: [ActionName, unknown][] = [
  ["createDiagramAction", { projectKey: "STK", title: "Flow", kind: "flow" }],
  ["saveDiagramAction", { diagramId: ID, baseVersion: 3, scene }],
  ["renameDiagramAction", { diagramId: ID, title: "New" }],
  ["deleteDiagramAction", { diagramId: ID }],
  ["moveDiagramAction", { diagramId: ID, index: 0 }],
  ["restoreDiagramVersionAction", { diagramId: ID, version: 1, baseVersion: 3 }],
  ["linkDiagramAction", { diagramId: ID, target: "issue", issueKey: "STK-1" }],
  ["unlinkDiagramAction", { diagramId: ID, linkId: ID }],
  ["requestThumbnailUploadAction", { diagramId: ID, sizeBytes: 1000 }],
  ["confirmThumbnailAction", { diagramId: ID }],
];
/** Read actions (session required, no actor). */
const readActions: [ActionName, unknown][] = [
  ["loadDiagramVersionAction", { diagramId: ID, version: 2 }],
  ["searchDiagramOptionsAction", { projectKey: "STK", q: "flow" }],
  ["searchLinkableDocsAction", { projectKey: "STK", q: "" }],
  ["loadDiagramTemplatesAction", undefined],
];

const allMocks = () => [...Object.values(diagramService), ...Object.values(diagramQueries)];

const call = (name: ActionName, input: unknown) =>
  (actions[name] as (input: unknown) => Promise<unknown>)(input);

describe("diagram server actions (S-2)", () => {
  beforeEach(() => {
    authMock.mockReset();
    revalidatePath.mockReset();
    for (const mock of allMocks()) mock.mockReset().mockResolvedValue({ version: 1 });
  });

  it("covers every exported action in these tests", () => {
    expect(new Set([...serviceActions, ...readActions].map(([name]) => name))).toEqual(
      new Set(Object.keys(actions)),
    );
  });

  it.each([...serviceActions, ...readActions])(
    "%s refuses without a session and touches nothing",
    async (name, input) => {
      authMock.mockResolvedValue(null);
      await expect(call(name, input)).rejects.toBeInstanceOf(UnauthorizedError);
      for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
    },
  );

  it.each(serviceActions)("%s calls its service as the session user", async (name, input) => {
    authMock.mockResolvedValue(session);
    await expect(call(name, input)).resolves.toMatchObject({ ok: true });
    const called = allMocks().filter((mock) => mock.mock.calls.length > 0);
    expect(called).toHaveLength(1);
    expect(called[0]?.mock.calls[0]?.[0]).toBe(ID);
  });

  it.each([...serviceActions, ...readActions.slice(0, 3)])(
    "%s rejects malformed input before the service",
    async (name) => {
      authMock.mockResolvedValue(session);
      await expect(call(name, { diagramId: "nope", projectKey: 1 })).resolves.toMatchObject({
        ok: false,
      });
      for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
    },
  );

  it("does not revalidate on autosave, but does after other changes", async () => {
    authMock.mockResolvedValue(session);
    await actions.saveDiagramAction({ diagramId: ID, baseVersion: 1, scene });
    expect(revalidatePath).not.toHaveBeenCalled();
    await actions.renameDiagramAction({ diagramId: ID, title: "x" });
    expect(revalidatePath).toHaveBeenCalledWith("/[projectKey]/diagrams", "page");
    expect(revalidatePath).toHaveBeenCalledWith("/[projectKey]/diagrams/[id]", "page");
  });

  it("validates the thumbnail request: a uuid id and 1 B…1 MB, never a client key", async () => {
    authMock.mockResolvedValue(session);
    for (const input of [
      { diagramId: ID, sizeBytes: 0 },
      { diagramId: ID, sizeBytes: 1024 * 1024 + 1 },
      { diagramId: "../../backups/x", sizeBytes: 10 },
    ]) {
      await expect(actions.requestThumbnailUploadAction(input)).resolves.toMatchObject({
        ok: false,
      });
    }
    await actions.requestThumbnailUploadAction({
      diagramId: ID,
      sizeBytes: 10,
      key: "backups/db.sql.gz",
    });
    // Unknown fields (a client-chosen key) never reach the service.
    expect(diagramService.requestThumbnailUpload).toHaveBeenCalledWith(ID, {
      diagramId: ID,
      sizeBytes: 10,
    });
  });

  it("turns expected service failures into { ok: false, error }", async () => {
    authMock.mockResolvedValue(session);
    diagramService.saveDiagram.mockRejectedValue(new ServiceError("invalid", "Too large"));
    await expect(
      actions.saveDiagramAction({ diagramId: ID, baseVersion: 1, scene }),
    ).resolves.toEqual({ ok: false, error: "Too large" });
  });

  it("reports a missing version as not found", async () => {
    authMock.mockResolvedValue(session);
    diagramQueries.getVersion.mockResolvedValue(null);
    await expect(actions.loadDiagramVersionAction({ diagramId: ID, version: 9 })).resolves.toEqual({
      ok: false,
      error: "Version 9 not found",
    });
  });
});
