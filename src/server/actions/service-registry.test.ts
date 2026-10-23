import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const serviceRegistry = vi.hoisted(() => ({
  createService: vi.fn(),
  updateService: vi.fn(),
  deleteService: vi.fn(),
  moveService: vi.fn(),
  addDefaults: vi.fn(),
  link: vi.fn(),
  unlink: vi.fn(),
}));
const serviceRegistryQueries = vi.hoisted(() => ({ docOptions: vi.fn() }));
vi.mock("@/server/services", () => ({ serviceRegistry, serviceRegistryQueries }));

const actions = await import("./service-registry");
const { UnauthorizedError } = await import("@/server/auth/require-session");

const ID = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const session: Session = {
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: ID, name: "Test Staff", email: "staff@example.test" },
};

type ActionName = keyof typeof actions;

const serviceActions: [ActionName, unknown][] = [
  ["createServiceAction", { projectKey: "STK", name: "inventory-api" }],
  ["updateServiceAction", { serviceId: ID, name: "inventory-api" }],
  ["deleteServiceAction", { serviceId: ID }],
  ["moveServiceAction", { serviceId: ID, index: 0 }],
  ["addDefaultServicesAction", { projectKey: "STK" }],
  ["linkServiceAction", { serviceId: ID, target: "issue", issueKey: "STK-1" }],
  ["unlinkServiceAction", { serviceId: ID, linkId: ID }],
];
const readActions: [ActionName, unknown][] = [
  ["searchServiceDocsAction", { projectKey: "STK", q: "run" }],
];

const allMocks = () => [
  ...Object.values(serviceRegistry),
  ...Object.values(serviceRegistryQueries),
];
const call = (name: ActionName, input: unknown) =>
  (actions[name] as (input: unknown) => Promise<unknown>)(input);

describe("service registry actions (S-2, SVC-1)", () => {
  beforeEach(() => {
    authMock.mockReset();
    revalidatePath.mockReset();
    for (const mock of allMocks()) mock.mockReset().mockResolvedValue({ id: ID, slug: "x" });
  });

  it("covers every exported action", () => {
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

  it.each([...serviceActions, ...readActions])(
    "%s rejects malformed input before the service",
    async (name) => {
      authMock.mockResolvedValue(session);
      await expect(call(name, { serviceId: "nope", projectKey: 1 })).resolves.toMatchObject({
        ok: false,
      });
      for (const mock of allMocks()) expect(mock).not.toHaveBeenCalled();
    },
  );

  it("refuses secrets and unsafe URLs before the service runs", async () => {
    authMock.mockResolvedValue(session);
    for (const extra of [
      { notes: "postgres://user:pass@db.example.internal/app" },
      { links: [{ label: "x", kind: "app", url: "javascript:alert(1)" }] },
      { environments: [{ name: "prod", url: "https://u:p@db.example.com" }] },
      { description: ["ghp_", "aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xYaB3d"].join("") },
    ]) {
      const result = await actions.createServiceAction({
        projectKey: "STK",
        name: "x",
        ...extra,
      });
      expect(result).toMatchObject({ ok: false });
    }
    expect(serviceRegistry.createService).not.toHaveBeenCalled();
  });
});
