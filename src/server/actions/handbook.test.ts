import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HANDBOOK_NOT_CONFIGURED_MESSAGE } from "@/lib/handbook/constants";
import { ServiceError } from "@/server/services/errors";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const handbookPublishService = vi.hoisted(() => ({ preview: vi.fn(), publish: vi.fn() }));
const handbookPullService = vi.hoisted(() => ({
  preview: vi.fn(),
  apply: vi.fn(),
  check: vi.fn(),
  importFile: vi.fn(),
}));
vi.mock("@/server/services", () => ({ handbookPublishService, handbookPullService }));

const actions = await import("./handbook");
const { UnauthorizedError } = await import("@/server/auth/require-session");

const ID = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const session: Session = {
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: ID, name: "Test Staff", email: "staff@example.test" },
};

const validInputs: [keyof typeof actions, unknown][] = [
  ["handbookPublishPreviewAction", { docId: ID, path: "RUNBOOK.md" }],
  ["handbookPublishAction", { projectKey: "STK", docIds: [ID], acknowledgedPublic: true }],
  ["handbookPullPreviewAction", { docId: ID }],
  ["handbookPullApplyAction", { docId: ID, baseVersion: 2, remoteSha: "a".repeat(40) }],
  ["handbookCheckAction", { projectKey: "STK" }],
  ["handbookImportFileAction", { projectKey: "STK", path: "NEW.md" }],
];

const allMocks = () => [
  ...Object.values(handbookPublishService),
  ...Object.values(handbookPullService),
];

describe("handbook server actions (DOC-14)", () => {
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
    await expect(
      actions[name]({ docId: "nope", projectKey: 1, path: "../x.md" }),
    ).resolves.toMatchObject({
      ok: false,
    });
    for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
  });

  it("refuses traversal paths, more than 50 docs and a path for several docs", async () => {
    authMock.mockResolvedValue(session);
    for (const path of ["../README.md", ".github/x.md", "/etc/x.md", "a/../b.md"]) {
      expect(await actions.handbookPublishPreviewAction({ docId: ID, path })).toMatchObject({
        ok: false,
      });
      expect(await actions.handbookImportFileAction({ projectKey: "STK", path })).toMatchObject({
        ok: false,
      });
    }
    const many = Array.from(
      { length: 51 },
      (_, i) => `7d1a2c4e-1f3b-4c5d-8e9f-${String(i).padStart(12, "0")}`,
    );
    expect(
      await actions.handbookPublishAction({
        projectKey: "STK",
        docIds: many,
        acknowledgedPublic: true,
      }),
    ).toMatchObject({
      ok: false,
      error: "Publish at most 50 docs at a time",
    });
    expect(
      await actions.handbookPublishAction({
        projectKey: "STK",
        docIds: [ID, many[0]],
        path: "X.md",
        acknowledgedPublic: true,
      }),
    ).toMatchObject({ ok: false });
    for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
  });

  it("requires the public-content acknowledgement", async () => {
    authMock.mockResolvedValue(session);
    expect(await actions.handbookPublishAction({ projectKey: "STK", docIds: [ID] })).toEqual({
      ok: false,
      error: "Confirm that the content may be public before publishing",
    });
    expect(handbookPublishService.publish).not.toHaveBeenCalled();
  });

  it("returns the not-configured refusal as an error", async () => {
    authMock.mockResolvedValue(session);
    handbookPublishService.publish.mockRejectedValue(
      new ServiceError("invalid", HANDBOOK_NOT_CONFIGURED_MESSAGE),
    );
    await expect(
      actions.handbookPublishAction({ projectKey: "STK", docIds: [ID], acknowledgedPublic: true }),
    ).resolves.toEqual({ ok: false, error: HANDBOOK_NOT_CONFIGURED_MESSAGE });
  });

  it("refreshes only the doc pages and settings after a publish", async () => {
    authMock.mockResolvedValue(session);
    await actions.handbookPublishAction({
      projectKey: "STK",
      docIds: [ID],
      acknowledgedPublic: true,
    });
    expect(revalidatePath.mock.calls.map(([path]) => path).sort()).toEqual([
      "/[projectKey]/docs/[id]",
      "/[projectKey]/settings",
    ]);
  });
});
