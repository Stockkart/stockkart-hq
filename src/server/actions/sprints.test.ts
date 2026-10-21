import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { conflict } from "@/server/services/errors";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const sprintService = vi.hoisted(() => ({
  createSprint: vi.fn(),
  updateSprint: vi.fn(),
  deleteSprint: vi.fn(),
  startSprint: vi.fn(),
  completeSprint: vi.fn(),
}));
const planningService = vi.hoisted(() => ({ moveIssueToSprint: vi.fn() }));
vi.mock("@/server/services", () => ({ sprintService, planningService }));

const actions = await import("./sprints");
const { UnauthorizedError } = await import("@/server/auth/require-session");

const USER = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const ID = "0f1e2d3c-4b5a-4968-8776-5544332211aa";
const session: Session = {
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: USER, name: "Test Staff", email: "staff@example.test" },
};
const dates = { startDate: "2026-06-01", endDate: "2026-06-14" };

type Name = keyof typeof actions;
const validInputs: [Name, unknown][] = [
  ["createSprintAction", { projectKey: "STK", name: "Sprint 1", goal: "", ...dates }],
  ["updateSprintAction", { sprintId: ID, name: "Sprint 1", goal: "Ship", ...dates }],
  ["deleteSprintAction", { sprintId: ID }],
  ["startSprintAction", { sprintId: ID }],
  ["completeSprintAction", { sprintId: ID, carryTo: "backlog" }],
  ["moveIssueToSprintAction", { issueId: ID, sprintId: null }],
];

const allMocks = () => [...Object.values(sprintService), ...Object.values(planningService)];

describe("sprint server actions (SPR-1/2, BLG-3)", () => {
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
      actions[name]({ sprintId: "nope", issueId: 5, projectKey: "x", carryTo: "trash" }),
    ).resolves.toMatchObject({ ok: false });
    for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(validInputs)(
    "%s refreshes the sprint views, not the project subtree",
    async (name, input) => {
      authMock.mockResolvedValue(session);
      await expect(actions[name](input)).resolves.toMatchObject({ ok: true });
      const paths = revalidatePath.mock.calls.map((call: unknown[]) => call[0]);
      expect(paths).toEqual(
        expect.arrayContaining(["/[projectKey]/backlog", "/[projectKey]/sprints"]),
      );
      expect(paths).not.toContain("/[projectKey]");
    },
  );

  it("acts as the signed-in user", async () => {
    authMock.mockResolvedValue(session);
    await actions.completeSprintAction({ sprintId: ID, carryTo: "next" });
    expect(sprintService.completeSprint).toHaveBeenCalledWith(USER, {
      sprintId: ID,
      carryTo: "next",
    });
    await actions.moveIssueToSprintAction({ issueId: ID, sprintId: ID, afterIssueId: null });
    expect(planningService.moveIssueToSprint).toHaveBeenCalledWith(USER, {
      issueId: ID,
      sprintId: ID,
      afterIssueId: null,
    });
  });

  it("returns the one-active-sprint conflict as an error", async () => {
    authMock.mockResolvedValue(session);
    sprintService.startSprint.mockRejectedValue(conflict("Another sprint is already active"));
    await expect(actions.startSprintAction({ sprintId: ID })).resolves.toEqual({
      ok: false,
      error: "Another sprint is already active",
    });
  });
});
