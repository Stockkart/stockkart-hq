import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const costService = vi.hoisted(() => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
  setActive: vi.fn(),
  deleteItem: vi.fn(),
  moveItem: vi.fn(),
  addDefaults: vi.fn(),
  setEntry: vi.fn(),
  clearEntry: vi.fn(),
  copyLastMonth: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock("@/server/services", () => ({ costService }));

const actions = await import("./costs");
const { UnauthorizedError } = await import("@/server/auth/require-session");

const ID = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const session: Session = {
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: ID, name: "Test Staff", email: "staff@example.test" },
};

const itemFields = {
  name: "Vercel",
  vendor: "Vercel",
  category: "hosting",
  billingCycle: "monthly",
  currency: "USD",
  expectedAmountMinor: 2000,
  renewsOn: null,
  serviceId: null,
  notes: "",
};

type ActionName = keyof typeof actions;

const cases: [ActionName, unknown][] = [
  ["createCostItemAction", { projectKey: "STK", ...itemFields }],
  ["updateCostItemAction", { itemId: ID, ...itemFields }],
  ["setCostItemActiveAction", { itemId: ID, active: false }],
  ["deleteCostItemAction", { itemId: ID }],
  ["moveCostItemAction", { itemId: ID, index: 0 }],
  ["addDefaultCostsAction", { projectKey: "STK" }],
  [
    "setCostEntryAction",
    {
      itemId: ID,
      month: "2026-10",
      amountMinor: 2000,
      currency: "USD",
      fxRate: "83.25",
      kind: "actual",
      notes: "",
    },
  ],
  ["clearCostEntryAction", { itemId: ID, month: "2026-10" }],
  ["copyLastMonthAction", { projectKey: "STK", month: "2026-10" }],
  [
    "updateCostSettingsAction",
    {
      projectKey: "STK",
      baseCurrency: "INR",
      monthlyBudgetMinor: null,
      reminderDay: 3,
      reminderUserIds: [ID],
      defaultUsdToInr: "",
    },
  ],
];

const allMocks = () => Object.values(costService);
const call = (name: ActionName, input: unknown) =>
  (actions[name] as (input: unknown) => Promise<unknown>)(input);

describe("costs actions (S-2, COST-1…8)", () => {
  beforeEach(() => {
    authMock.mockReset();
    revalidatePath.mockReset();
    for (const mock of allMocks()) mock.mockReset().mockResolvedValue({ id: ID });
  });

  it("covers every exported action", () => {
    expect(new Set(cases.map(([name]) => name))).toEqual(new Set(Object.keys(actions)));
  });

  it.each(cases)("%s refuses without a session and touches nothing", async (name, input) => {
    authMock.mockResolvedValue(null);
    await expect(call(name, input)).rejects.toBeInstanceOf(UnauthorizedError);
    for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
  });

  it.each(cases)("%s calls its service as the session user", async (name, input) => {
    authMock.mockResolvedValue(session);
    await expect(call(name, input)).resolves.toMatchObject({ ok: true });
    const called = allMocks().filter((mock) => mock.mock.calls.length > 0);
    expect(called).toHaveLength(1);
    expect(called[0]?.mock.calls[0]?.[0]).toBe(ID);
    expect(revalidatePath).toHaveBeenCalledWith("/[projectKey]/costs", "page");
  });

  it.each(cases)("%s rejects malformed input before the service", async (name) => {
    authMock.mockResolvedValue(session);
    await expect(call(name, { itemId: "nope", projectKey: 1 })).resolves.toMatchObject({
      ok: false,
    });
    for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
  });

  it.each([
    ["a negative amount", { amountMinor: -1 }],
    ["a float amount", { amountMinor: 12.5 }],
    ["an amount over the maximum", { amountMinor: 1_000_000_000_000 }],
    ["a no-charge month with an amount", { kind: "no_charge", amountMinor: 5 }],
    ["a malformed rate", { fxRate: "83,25,1" }],
    ["a zero rate", { fxRate: "0" }],
    ["a day-of-month period", { month: "2026-10-05" }],
    ["a secret in the notes", { notes: "password=hunter2-hunter2" }],
  ])("refuses an entry with %s", async (_label, patch) => {
    authMock.mockResolvedValue(session);
    const [, input] = cases.find(([name]) => name === "setCostEntryAction") ?? [];
    const result = await actions.setCostEntryAction({ ...(input as object), ...patch });
    expect(result).toMatchObject({ ok: false });
    expect(costService.setEntry).not.toHaveBeenCalled();
  });

  it("passes a canonical rate and refuses reminder days outside 1…28", async () => {
    authMock.mockResolvedValue(session);
    await actions.setCostEntryAction({
      itemId: ID,
      month: "2026-10",
      amountMinor: 100,
      currency: "USD",
      fxRate: "83.25",
      kind: "actual",
      notes: "",
    });
    expect(costService.setEntry.mock.calls[0]?.[1]).toMatchObject({ fxRate: "83.250000" });
    for (const reminderDay of [0, 29, 1.5]) {
      const result = await actions.updateCostSettingsAction({
        projectKey: "STK",
        baseCurrency: "INR",
        monthlyBudgetMinor: null,
        reminderDay,
        reminderUserIds: [],
        defaultUsdToInr: null,
      });
      expect(result).toMatchObject({ ok: false });
    }
    expect(costService.updateSettings).not.toHaveBeenCalled();
  });
});
