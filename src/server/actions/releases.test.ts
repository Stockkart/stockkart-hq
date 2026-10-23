import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { conflict } from "@/server/services/errors";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const releaseService = vi.hoisted(() => ({
  createRelease: vi.fn(),
  updateRelease: vi.fn(),
  deleteRelease: vi.fn(),
  markReleased: vi.fn(),
  reopenRelease: vi.fn(),
  generateNotes: vi.fn(),
}));
const releaseQueries = vi.hoisted(() => ({ releaseOptions: vi.fn() }));
const importService = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn() }));
vi.mock("@/server/services", () => ({ releaseService, releaseQueries, importService }));

const releases = await import("./releases");
const imports = await import("./imports");
const { UnauthorizedError } = await import("@/server/auth/require-session");

const USER = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const ID = "0f1e2d3c-4b5a-4968-8776-5544332211aa";
const OTHER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const session: Session = {
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: USER, name: "Test Staff", email: "staff@example.test" },
};

const actions = { ...releases, ...imports };
type Name = keyof typeof actions;
const validInputs: [Name, unknown][] = [
  ["createReleaseAction", { projectKey: "STK", name: "api-v1.4", releaseDate: "2026-06-30" }],
  ["updateReleaseAction", { releaseId: ID, name: "api-v1.4", releaseDate: "", description: "" }],
  ["deleteReleaseAction", { releaseId: ID }],
  ["markReleasedAction", { releaseId: ID, openIssues: { action: "move", targetReleaseId: OTHER } }],
  ["reopenReleaseAction", { releaseId: ID }],
  ["generateReleaseNotesAction", { releaseId: ID }],
  ["loadReleaseOptionsAction", { projectKey: "STK" }],
  [
    "previewImportAction",
    { projectKey: "STK", filename: "a.csv", fields: ["title"], rows: [["A"]] },
  ],
  ["applyImportAction", { importId: ID, fields: ["title"], rows: [["A"]] }],
];

const allMocks = () => [
  ...Object.values(releaseService),
  ...Object.values(releaseQueries),
  ...Object.values(importService),
];

describe("release and import server actions (REL-1/2, IMP-4)", () => {
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

  it.each(validInputs)("%s rejects malformed input before the service", async (name) => {
    authMock.mockResolvedValue(session);
    await expect(
      actions[name]({ releaseId: "nope", projectKey: "x", importId: 5, rows: "all" }),
    ).resolves.toMatchObject({ ok: false });
    for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(validInputs)(
    "%s runs as the signed-in user, never refreshing the project subtree",
    async (name, input) => {
      authMock.mockResolvedValue(session);
      await expect(actions[name](input)).resolves.toMatchObject({ ok: true });
      const paths = revalidatePath.mock.calls.map((call: unknown[]) => call[0]);
      expect(paths).not.toContain("/[projectKey]");
    },
  );

  it("passes the actor and the parsed input", async () => {
    authMock.mockResolvedValue(session);
    await actions.markReleasedAction({ releaseId: ID, openIssues: { action: "keep" } });
    expect(releaseService.markReleased).toHaveBeenCalledWith(USER, {
      releaseId: ID,
      openIssues: { action: "keep" },
    });
    await actions.deleteReleaseAction({ releaseId: ID });
    expect(releaseService.deleteRelease).toHaveBeenCalledWith(USER, {
      releaseId: ID,
      unsetIssues: false,
    });
    await actions.createReleaseAction({ projectKey: "STK", name: "  api   v2 " });
    expect(releaseService.createRelease).toHaveBeenCalledWith(USER, {
      projectKey: "STK",
      name: "api v2",
      releaseDate: null,
      description: null,
    });
  });

  it("refuses moving open issues into the release being released", async () => {
    authMock.mockResolvedValue(session);
    await expect(
      actions.markReleasedAction({
        releaseId: ID,
        openIssues: { action: "move", targetReleaseId: ID },
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(releaseService.markReleased).not.toHaveBeenCalled();
  });

  it("refreshes the release pages and the issue views on fix-version changes", async () => {
    authMock.mockResolvedValue(session);
    await actions.deleteReleaseAction({ releaseId: ID, unsetIssues: true });
    const paths = revalidatePath.mock.calls.map((call: unknown[]) => call[0]);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/[projectKey]/releases",
        "/[projectKey]/releases/[releaseId]",
        "/[projectKey]/issues",
      ]),
    );
  });

  it("returns a service conflict (e.g. open issues) as an error", async () => {
    authMock.mockResolvedValue(session);
    releaseService.markReleased.mockRejectedValue(conflict("2 issues are not done yet"));
    await expect(actions.markReleasedAction({ releaseId: ID })).resolves.toEqual({
      ok: false,
      error: "2 issues are not done yet",
    });
  });

  it("refuses an import of more than 500 rows before the service", async () => {
    authMock.mockResolvedValue(session);
    const rows = Array.from({ length: 501 }, (_, i) => [`Issue ${i}`]);
    await expect(
      actions.previewImportAction({
        projectKey: "STK",
        filename: "a.csv",
        fields: ["title"],
        rows,
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(importService.preview).not.toHaveBeenCalled();
  });
});
