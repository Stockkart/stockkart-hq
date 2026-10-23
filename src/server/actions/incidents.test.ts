import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const incidentService = vi.hoisted(() => ({
  declareIncident: vi.fn(),
  setStatus: vi.fn(),
  updateTimes: vi.fn(),
  updateIncident: vi.fn(),
  setServices: vi.fn(),
  addTimelineEntry: vi.fn(),
  editTimelineEntry: vi.fn(),
  deleteTimelineEntry: vi.fn(),
  linkFollowUp: vi.fn(),
  unlinkFollowUp: vi.fn(),
  createPostmortem: vi.fn(),
}));
vi.mock("@/server/services", () => ({ incidentService }));

const actions = await import("./incidents");
const { UnauthorizedError } = await import("@/server/auth/require-session");

const ID = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const AT = "2026-10-20T10:00:00.000Z";
const session: Session = {
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: ID, name: "Test Staff", email: "staff@example.test" },
};

type ActionName = keyof typeof actions;

const serviceActions: [ActionName, unknown][] = [
  ["declareIncidentAction", { projectKey: "STK", title: "Down", severity: "sev1" }],
  ["setIncidentStatusAction", { incidentId: ID, from: "investigating", to: "mitigated" }],
  [
    "updateIncidentTimesAction",
    { incidentId: ID, startedAt: AT, mitigatedAt: null, resolvedAt: null },
  ],
  ["updateIncidentAction", { incidentId: ID, severity: "sev2" }],
  ["setIncidentServicesAction", { incidentId: ID, serviceIds: [ID] }],
  ["addTimelineEntryAction", { incidentId: ID, kind: "note", body: "Looking" }],
  ["editTimelineEntryAction", { entryId: ID, body: "Edited", at: AT }],
  ["deleteTimelineEntryAction", { entryId: ID }],
  ["linkFollowUpAction", { incidentId: ID, issueKey: "STK-1" }],
  ["unlinkFollowUpAction", { incidentId: ID, linkId: ID }],
  ["createPostmortemAction", { incidentId: ID }],
];

const allMocks = () => Object.values(incidentService);
const call = (name: ActionName, input: unknown) =>
  (actions[name] as (input: unknown) => Promise<unknown>)(input);

describe("incident actions (S-2, INC-1/2)", () => {
  beforeEach(() => {
    authMock.mockReset();
    revalidatePath.mockReset();
    for (const mock of allMocks()) mock.mockReset().mockResolvedValue({ id: ID });
  });

  it("covers every exported action", () => {
    expect(new Set(serviceActions.map(([name]) => name))).toEqual(new Set(Object.keys(actions)));
  });

  it.each(serviceActions)(
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

  it.each(serviceActions)("%s rejects malformed input before the service", async (name) => {
    authMock.mockResolvedValue(session);
    await expect(
      call(name, { incidentId: "nope", entryId: "nope", projectKey: 1 }),
    ).resolves.toMatchObject({ ok: false });
    for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
  });

  it("refuses system-only timeline kinds and bad severities", async () => {
    authMock.mockResolvedValue(session);
    await expect(
      actions.addTimelineEntryAction({ incidentId: ID, kind: "status_change", body: "x" }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      actions.declareIncidentAction({ projectKey: "STK", title: "x", severity: "sev0" }),
    ).resolves.toMatchObject({ ok: false });
    expect(incidentService.addTimelineEntry).not.toHaveBeenCalled();
    expect(incidentService.declareIncident).not.toHaveBeenCalled();
  });

  it("refreshes the incident pages and the issue page after linking a follow-up", async () => {
    authMock.mockResolvedValue(session);
    await actions.linkFollowUpAction({ incidentId: ID, issueKey: "stk-1" });
    expect(incidentService.linkFollowUp).toHaveBeenCalledWith(ID, {
      incidentId: ID,
      issueKey: "STK-1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/[projectKey]/incidents/[key]", "page");
    expect(revalidatePath).toHaveBeenCalledWith("/[projectKey]/issues/[key]", "page");
  });
});
