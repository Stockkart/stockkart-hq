import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BULK_MAX } from "@/lib/issues/bulk";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const projectSettingsService = vi.hoisted(() => ({
  updateProject: vi.fn(),
  createStatus: vi.fn(),
  renameStatus: vi.fn(),
  setStatusCategory: vi.fn(),
  setStatusDefault: vi.fn(),
  moveStatus: vi.fn(),
  deleteStatus: vi.fn(),
  createLabel: vi.fn(),
  renameLabel: vi.fn(),
  setLabelColor: vi.fn(),
  deleteLabel: vi.fn(),
  createComponent: vi.fn(),
  renameComponent: vi.fn(),
  setComponentRepo: vi.fn(),
  deleteComponent: vi.fn(),
}));
const savedViewService = vi.hoisted(() => ({
  create: vi.fn(),
  updateFilter: vi.fn(),
  rename: vi.fn(),
  setShared: vi.fn(),
  remove: vi.fn(),
  move: vi.fn(),
}));
const bulkService = vi.hoisted(() => ({ bulkEdit: vi.fn() }));
const trashService = vi.hoisted(() => ({ restore: vi.fn() }));
vi.mock("@/server/services", () => ({
  projectSettingsService,
  savedViewService,
  bulkService,
  trashService,
}));

const settings = await import("./settings");
const views = await import("./saved-views");
const bulk = await import("./bulk");
const trash = await import("./trash");
const { UnauthorizedError } = await import("@/server/auth/require-session");

const USER = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const ID = "0f1e2d3c-4b5a-4968-8776-5544332211aa";
const ID2 = "1f1e2d3c-4b5a-4968-8776-5544332211ab";
const session: Session = {
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: USER, name: "Test Staff", email: "staff@example.test" },
};

type AnyAction = (input: unknown) => Promise<unknown>;
const cases: [string, AnyAction, unknown][] = [
  [
    "updateProjectSettingsAction",
    settings.updateProjectSettingsAction,
    {
      projectKey: "STK",
      name: "Stockkart",
      description: null,
      leadId: null,
      defaultAssigneeId: ID,
      sprintLengthDays: 14,
    },
  ],
  [
    "createStatusAction",
    settings.createStatusAction,
    { projectKey: "STK", name: "QA", category: "in_progress" },
  ],
  ["renameStatusAction", settings.renameStatusAction, { statusId: ID, name: "QA" }],
  ["setStatusCategoryAction", settings.setStatusCategoryAction, { statusId: ID, category: "done" }],
  ["setStatusDefaultAction", settings.setStatusDefaultAction, { statusId: ID, kind: "bug" }],
  ["moveStatusAction", settings.moveStatusAction, { statusId: ID, afterStatusId: null }],
  ["deleteStatusAction", settings.deleteStatusAction, { statusId: ID, moveToStatusId: ID2 }],
  [
    "createLabelAction",
    settings.createLabelAction,
    { projectKey: "STK", name: "Perf Work", color: "#ef4444" },
  ],
  ["renameLabelAction", settings.renameLabelAction, { labelId: ID, name: "perf" }],
  ["setLabelColorAction", settings.setLabelColorAction, { labelId: ID, color: null }],
  ["deleteLabelAction", settings.deleteLabelAction, { labelId: ID }],
  [
    "createComponentAction",
    settings.createComponentAction,
    { projectKey: "STK", name: "mobile", githubRepo: "Stockkart/mobile" },
  ],
  ["renameComponentAction", settings.renameComponentAction, { componentId: ID, name: "x" }],
  [
    "setComponentRepoAction",
    settings.setComponentRepoAction,
    { componentId: ID, githubRepo: null },
  ],
  ["deleteComponentAction", settings.deleteComponentAction, { componentId: ID }],
  [
    "saveViewAction",
    views.saveViewAction,
    { projectKey: "STK", name: "Bugs", shared: false, query: "type=bug" },
  ],
  ["updateViewFilterAction", views.updateViewFilterAction, { viewId: ID, query: "" }],
  ["renameViewAction", views.renameViewAction, { viewId: ID, name: "x" }],
  ["setViewSharedAction", views.setViewSharedAction, { viewId: ID, shared: true }],
  ["deleteViewAction", views.deleteViewAction, { viewId: ID }],
  ["moveViewAction", views.moveViewAction, { viewId: ID, afterViewId: null }],
  [
    "bulkEditIssuesAction",
    bulk.bulkEditIssuesAction,
    { projectKey: "STK", issueIds: [ID], change: { kind: "priority", priority: 1 } },
  ],
  [
    "restoreFromTrashAction",
    trash.restoreFromTrashAction,
    { projectKey: "STK", kind: "issue", id: ID },
  ],
];

const allMocks = () => [
  ...Object.values(projectSettingsService),
  ...Object.values(savedViewService),
  ...Object.values(bulkService),
  ...Object.values(trashService),
];

describe("settings, saved view, bulk and trash server actions", () => {
  beforeEach(() => {
    authMock.mockReset();
    for (const mock of allMocks()) mock.mockReset().mockResolvedValue({});
  });

  it.each(cases)(
    "%s refuses without a session and touches nothing",
    async (_name, action, input) => {
      authMock.mockResolvedValue(null);
      await expect(action(input)).rejects.toBeInstanceOf(UnauthorizedError);
      for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
    },
  );

  it.each(cases)("%s rejects malformed input before the service", async (_name, action) => {
    authMock.mockResolvedValue(session);
    await expect(
      action({ statusId: "nope", labelId: 1, viewId: "x", projectKey: "lower", issueIds: "x" }),
    ).resolves.toMatchObject({ ok: false });
    for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
  });

  it.each(cases)("%s succeeds with valid input", async (_name, action, input) => {
    authMock.mockResolvedValue(session);
    await expect(action(input)).resolves.toMatchObject({ ok: true });
  });

  it("passes the session user to the saved-view service, never one from the input", async () => {
    authMock.mockResolvedValue(session);
    const other = "aaaaaaaa-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
    await views.renameViewAction({ viewId: ID, name: "x", userId: other });
    await views.deleteViewAction({ viewId: ID, userId: other });
    expect(savedViewService.rename).toHaveBeenCalledWith(USER, { viewId: ID, name: "x" });
    expect(savedViewService.remove).toHaveBeenCalledWith(USER, ID);
  });

  it(`refuses more than ${BULK_MAX} issues before the service runs`, async () => {
    authMock.mockResolvedValue(session);
    const issueIds = Array.from({ length: BULK_MAX + 1 }, () => crypto.randomUUID());
    await expect(
      bulk.bulkEditIssuesAction({ projectKey: "STK", issueIds, change: { kind: "delete" } }),
    ).resolves.toEqual({ ok: false, error: `Select at most ${BULK_MAX} issues at once` });
    expect(bulkService.bulkEdit).not.toHaveBeenCalled();
  });

  it("rejects a GitHub repo that is not Owner/repo, and a colour off the palette", async () => {
    authMock.mockResolvedValue(session);
    await expect(
      settings.setComponentRepoAction({ componentId: ID, githubRepo: "inventory-api" }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      settings.setLabelColorAction({ labelId: ID, color: "#123456" }),
    ).resolves.toMatchObject({ ok: false });
    expect(projectSettingsService.setComponentRepo).not.toHaveBeenCalled();
    expect(projectSettingsService.setLabelColor).not.toHaveBeenCalled();
  });
});
