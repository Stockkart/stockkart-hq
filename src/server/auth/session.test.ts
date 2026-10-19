import type { User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { describe, expect, it } from "vitest";

import {
  API_BASE,
  apiError,
  callsTo,
  meOk,
  memoryAttemptStore,
  memoryUserRepository,
  mockFetch,
  timeoutError,
} from "@/test/stockkart-fakes";

import { buildAuthConfig, createAuthHandlers, type AuthConfigDeps } from "./config";
import { createRateLimiter } from "./rate-limit";
import {
  MAX_UNVERIFIED_MS,
  RECHECK_INTERVAL_MS,
  RECHECK_RETRY_MS,
  SESSION_MAX_AGE_SECONDS,
  STOCKKART_TOKEN_TTL_MS,
} from "./session-policy";
import { createStockkartClient } from "./stockkart-client";

const SIGNED_IN_AT = Date.UTC(2026, 5, 1, 9, 0, 0);
const HOUR = 60 * 60 * 1000;

const signedInUser: User = {
  id: "hq-1",
  name: "Test Staff",
  email: "staff@example.test",
  stockkartUserId: "sk-user-1",
  stockkartAccessToken: "tok-super",
  sessionVersion: 0,
};

function setup(handler: Parameters<typeof mockFetch>[0]) {
  const fetchMock = mockFetch(handler);
  let clock = SIGNED_IN_AT;
  const users = memoryUserRepository();
  const deps: AuthConfigDeps = {
    secret: "test-only-secret-not-used-anywhere-real-000000",
    client: createStockkartClient({ baseUrl: API_BASE, fetch: fetchMock }),
    limiter: createRateLimiter(memoryAttemptStore()),
    users,
    now: () => clock,
  };
  const handlers = createAuthHandlers(deps);

  return {
    deps,
    fetchMock,
    handlers,
    users,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    /** The jwt callback as Auth.js calls it at sign-in. */
    signIn: async (): Promise<JWT> => {
      // The HQ users row authorize() would have upserted (id hq-1, session_version 0).
      await users.upsertOnSignIn({
        stockkartUserId: "sk-user-1",
        name: "Test Staff",
        email: "staff@example.test",
      });
      const token = await handlers.jwt({
        token: { name: signedInUser.name, email: signedInUser.email, sub: signedInUser.id },
        user: signedInUser,
      });
      if (!token) throw new Error("sign-in token was null");
      return token;
    },
    /** The jwt callback as Auth.js calls it on every later session read (no `user`). */
    read: (token: JWT) => handlers.jwt({ token }),
  };
}

describe("Auth.js config", () => {
  it("uses JWT sessions that never outlive the 7-day Stockkart token (AUTH-3)", () => {
    const { deps, handlers } = setup(() => apiError(500));
    const config = buildAuthConfig(deps);
    expect(SESSION_MAX_AGE_SECONDS * 1000).toBeLessThanOrEqual(STOCKKART_TOKEN_TTL_MS);
    expect(config.session).toEqual({ strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS });
    expect(config.debug).toBe(false);
    expect(config.callbacks?.jwt).toBeTypeOf("function");
    expect(handlers.jwt).toBeTypeOf("function");
  });

  it("ends the session at the absolute deadline even if it keeps being used", async () => {
    const { signIn, read, advance, fetchMock } = setup(() => meOk("SUPER_USER"));
    const token = await signIn();
    advance(STOCKKART_TOKEN_TTL_MS);
    expect(await read(token)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("jwt callback: hourly /auth/me re-check (AUTH-4)", () => {
  it("does not call inventory-api within the first hour", async () => {
    const { signIn, read, advance, fetchMock } = setup(() => meOk("SUPER_USER"));
    const token = await signIn();
    advance(HOUR - 1);
    expect(await read(token)).toEqual(token);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a still-valid SUPER_USER and schedules the next check an hour later", async () => {
    const { signIn, read, advance, now, fetchMock } = setup(() => meOk("SUPER_USER"));
    const token = await signIn();
    advance(HOUR + 1);

    const next = await read(token);
    expect(next).toMatchObject({ lastVerifiedAt: now(), recheckAt: now() + RECHECK_INTERVAL_MS });

    const [meCall] = callsTo(fetchMock, "/api/v1/auth/me");
    expect(meCall?.[1]).toMatchObject({
      method: "GET",
      headers: expect.objectContaining({ Authorization: "Bearer tok-super" }),
    });
  });

  it.each([401, 403])("invalidates the session when /auth/me returns %i", async (status) => {
    const { signIn, read, advance } = setup(() => apiError(status));
    const token = await signIn();
    advance(HOUR + 1);
    expect(await read(token)).toBeNull();
  });

  it.each(["OWNER", "CASHIER"])(
    "invalidates the session and drops the token when the role changed to %s",
    async (role) => {
      const { signIn, read, advance, fetchMock } = setup((url) =>
        url.endsWith("/auth/me") ? meOk(role) : new Response(null, { status: 200 }),
      );
      const token = await signIn();
      advance(HOUR + 1);
      expect(await read(token)).toBeNull();
      expect(callsTo(fetchMock, "/api/v1/auth/logout")).toHaveLength(1);
    },
  );

  it("invalidates the session when the token now belongs to a different user", async () => {
    const { signIn, read, advance } = setup(() => meOk("SUPER_USER", { userId: "someone-else" }));
    const token = await signIn();
    advance(HOUR + 1);
    expect(await read(token)).toBeNull();
  });

  it.each([
    ["a 500", () => apiError(500)],
    ["a 503", () => apiError(503)],
    ["a timeout", () => Promise.reject(timeoutError())],
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
  ])("keeps the session on %s and retries a few minutes later", async (_label, respond) => {
    const { signIn, read, advance, now, fetchMock } = setup(respond);
    const token = await signIn();
    advance(HOUR + 1);

    const kept = await read(token);
    expect(kept).toMatchObject({
      sub: "hq-1",
      lastVerifiedAt: SIGNED_IN_AT,
      recheckAt: now() + RECHECK_RETRY_MS,
    });

    // Within the back-off window no further calls are made.
    advance(RECHECK_RETRY_MS - 1);
    expect(kept).not.toBeNull();
    if (kept) await read(kept);
    expect(callsTo(fetchMock, "/api/v1/auth/me")).toHaveLength(1);
  });

  it("rejects a token that lacks HQ claims", async () => {
    const { read } = setup(() => meOk("SUPER_USER"));
    expect(await read({ sub: "hq-1", name: "x" })).toBeNull();
  });
});

describe("jwt callback: session_version check (S-3)", () => {
  it("keeps the session when the stored session_version still matches", async () => {
    const { signIn, read, advance, now } = setup(() => meOk("SUPER_USER"));
    const token = await signIn();
    advance(HOUR + 1);
    expect(await read(token)).toMatchObject({ sessionVersion: 0, lastVerifiedAt: now() });
  });

  it("ends the session and drops the Stockkart token after 'sign out everywhere'", async () => {
    const { signIn, read, advance, users, fetchMock } = setup((url) =>
      url.endsWith("/auth/me") ? meOk("SUPER_USER") : new Response(null, { status: 200 }),
    );
    const token = await signIn();
    users.bumpSessionVersion("hq-1");

    // Not before the re-check is due: no DB read on every request.
    advance(HOUR - 1);
    expect(await read(token)).toEqual(token);

    advance(2);
    expect(await read(token)).toBeNull();
    expect(callsTo(fetchMock, "/api/v1/auth/logout")).toHaveLength(1);
  });

  it("ends the session when the HQ user no longer exists", async () => {
    const { handlers, read, advance } = setup(() => meOk("SUPER_USER"));
    // Sign in without seeding the users row.
    const token = await handlers.jwt({ token: { sub: "hq-1" }, user: signedInUser });
    expect(token).not.toBeNull();
    advance(HOUR + 1);
    expect(token && (await read(token))).toBeNull();
  });

  it("ends the session on a version mismatch even while inventory-api is down", async () => {
    const { signIn, read, advance, users } = setup(() => apiError(503));
    const token = await signIn();
    users.bumpSessionVersion("hq-1");
    advance(HOUR + 1);
    expect(await read(token)).toBeNull();
  });

  it("keeps the session like an outage when the DB is unreachable (not verified)", async () => {
    const { signIn, read, advance, users, now } = setup(() => meOk("SUPER_USER"));
    const token = await signIn();
    users.failReads(true);
    advance(HOUR + 1);
    expect(await read(token)).toMatchObject({
      lastVerifiedAt: SIGNED_IN_AT,
      recheckAt: now() + RECHECK_RETRY_MS,
    });
  });
});

describe("jwt callback: 24 h ceiling without a successful re-check", () => {
  /** Reads the session every retry interval until `until` ms after sign-in. */
  async function keepReading(
    ctx: ReturnType<typeof setup>,
    token: JWT,
    until: number,
  ): Promise<JWT | null> {
    let current: JWT | null = token;
    while (current && ctx.now() - SIGNED_IN_AT < until) {
      ctx.advance(HOUR);
      current = await ctx.read(current);
    }
    return current;
  }

  it.each([
    ["inventory-api keeps failing", () => apiError(503)],
    ["/auth/me keeps returning an unexpected body", () => new Response("<html>", { status: 200 })],
  ])("keeps the session for under 24 h, then ends it, when %s", async (_label, respond) => {
    const ctx = setup(respond);
    const token = await ctx.signIn();

    const before = await keepReading(ctx, token, MAX_UNVERIFIED_MS - HOUR);
    expect(before).toMatchObject({ lastVerifiedAt: SIGNED_IN_AT });
    if (!before) throw new Error("session ended too early");

    expect(await keepReading(ctx, before, MAX_UNVERIFIED_MS)).toBeNull();
  });

  it("ends the session after 24 h when the DB stays unreachable", async () => {
    const ctx = setup(() => meOk("SUPER_USER"));
    const token = await ctx.signIn();
    ctx.users.failReads(true);
    expect(await keepReading(ctx, token, MAX_UNVERIFIED_MS)).toBeNull();
  });

  it("restarts the 24 h clock after a successful re-check", async () => {
    let healthy = false;
    const ctx = setup(() => (healthy ? meOk("SUPER_USER") : apiError(503)));
    const token = await ctx.signIn();

    const degraded = await keepReading(ctx, token, MAX_UNVERIFIED_MS - HOUR);
    healthy = true;
    ctx.advance(RECHECK_RETRY_MS);
    const recovered = degraded && (await ctx.read(degraded));
    expect(recovered).toMatchObject({ lastVerifiedAt: ctx.now() });

    healthy = false;
    // 23 h after recovery the session is still alive although inventory-api is down again.
    ctx.advance(MAX_UNVERIFIED_MS - HOUR);
    expect(recovered && (await ctx.read(recovered))).not.toBeNull();
  });
});

describe("session callback", () => {
  it("exposes only id, name and email, never the Stockkart token", async () => {
    const { signIn, handlers } = setup(() => meOk("SUPER_USER"));
    const token = await signIn();
    const session = handlers.session({ session: { expires: "2026-06-02T09:00:00.000Z" }, token });
    expect(session.user).toEqual({ id: "hq-1", name: "Test Staff", email: "staff@example.test" });
    expect(JSON.stringify(session)).not.toContain("tok-super");
  });
});

describe("signOut event (AUTH-7)", () => {
  it("calls inventory-api logout with the session's token", async () => {
    const { signIn, handlers, fetchMock } = setup(() => new Response(null, { status: 200 }));
    const token = await signIn();
    await handlers.signOut({ token });
    const calls = callsTo(fetchMock, "/api/v1/auth/logout");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer tok-super" }),
    });
  });
});
