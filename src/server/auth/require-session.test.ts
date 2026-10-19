import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("./auth", () => ({ auth: authMock }));

const { requireSession, UnauthorizedError, withSession } = await import("./require-session");

const session: Session = {
  expires: "2026-06-02T09:00:00.000Z",
  user: { id: "hq-1", name: "Test Staff", email: "staff@example.test" },
};

describe("requireSession (S-2)", () => {
  beforeEach(() => authMock.mockReset());

  it("returns the session when signed in", async () => {
    authMock.mockResolvedValue(session);
    await expect(requireSession()).resolves.toEqual(session);
  });

  it("throws UnauthorizedError without a session", async () => {
    authMock.mockResolvedValue(null);
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("withSession answers 401 and never calls the handler without a session", async () => {
    authMock.mockResolvedValue(null);
    const handler = vi.fn(async () => new Response("secret"));
    const response = await withSession(handler)();
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("withSession passes the session to the handler", async () => {
    authMock.mockResolvedValue(session);
    const response = await withSession(async (s: Session) => new Response(s.user.id))();
    expect(await response.text()).toBe("hq-1");
  });
});
