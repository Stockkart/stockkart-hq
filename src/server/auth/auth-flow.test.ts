import NextAuth from "next-auth";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  API_BASE,
  apiError,
  callsTo,
  loginOk,
  meOk,
  memoryAttemptStore,
  memoryUserRepository,
  mockFetch,
} from "@/test/stockkart-fakes";

import { handleRequest } from "./access-policy";
import { buildAuthConfig } from "./config";
import { createRateLimiter } from "./rate-limit";
import { RECHECK_INTERVAL_MS } from "./session-policy";
import { createStockkartClient } from "./stockkart-client";

/**
 * Integration test through the real Auth.js request handlers and the real proxy wrapper,
 * with real cookie encryption. Only inventory-api (mocked fetch) and the database
 * (in-memory fakes) are replaced.
 */

const ORIGIN = "http://localhost:3000";
const SESSION_COOKIE = "authjs.session-token";

function cookiePairs(response: Response): string[] {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0] ?? "");
}

function setup(role: string) {
  let clock = Date.now();
  let meStatus: "ok" | "unauthorized" = "ok";
  const fetchMock = mockFetch((url) => {
    if (url.endsWith("/auth/login")) return loginOk(role, "tok-flow");
    if (url.endsWith("/auth/me")) return meStatus === "ok" ? meOk(role) : apiError(401);
    return new Response(null, { status: 200 });
  });
  const { handlers, auth } = NextAuth(
    buildAuthConfig({
      secret: "test-only-secret-not-used-anywhere-real-000000",
      client: createStockkartClient({ baseUrl: API_BASE, fetch: fetchMock }),
      limiter: createRateLimiter(memoryAttemptStore()),
      users: memoryUserRepository(),
      now: () => clock,
    }),
  );
  const proxy = auth(handleRequest);

  async function signIn(): Promise<Response> {
    const csrf = await handlers.GET(new NextRequest(`${ORIGIN}/api/auth/csrf`));
    const { csrfToken } = (await csrf.json()) as { csrfToken: string };
    return handlers.POST(
      new NextRequest(`${ORIGIN}/api/auth/callback/credentials`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: cookiePairs(csrf).join("; "),
          "x-real-ip": "203.0.113.7",
        },
        body: new URLSearchParams({
          email: "staff@example.test",
          password: "correct horse",
          csrfToken,
          callbackUrl: `${ORIGIN}/my-work`,
        }),
      }),
    );
  }

  async function visit(path: string, cookie: string): Promise<Response> {
    // The Next.js server sets host and x-forwarded-proto on every request; Auth.js derives
    // the (non-)__Secure- cookie name from them, so the test must send them too.
    const request = new NextRequest(`${ORIGIN}${path}`, {
      headers: { cookie, host: "localhost:3000", "x-forwarded-proto": "http" },
    });
    const response = await proxy(request, { params: Promise.resolve({}) });
    if (!response) throw new Error("no response");
    return response;
  }

  return {
    fetchMock,
    signIn,
    visit,
    advance: (ms: number) => {
      clock += ms;
    },
    revokeToken: () => {
      meStatus = "unauthorized";
    },
  };
}

describe("sign-in flow through Auth.js", () => {
  it("signs a SUPER_USER in, lets the session through the proxy, and ends it on a 401 re-check", async () => {
    const { signIn, visit, advance, revokeToken, fetchMock } = setup("SUPER_USER");

    const response = await signIn();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/my-work`);
    const session = cookiePairs(response).find((pair) => pair.startsWith(`${SESSION_COOKIE}=`));
    expect(session).toBeDefined();
    // The cookie is encrypted: the Stockkart token is not readable from it.
    expect(session).not.toContain("tok-flow");
    const sessionCookie = session ?? "";
    expect(response.headers.getSetCookie().join("\n")).toMatch(/HttpOnly/i);

    const allowed = await visit("/my-work", sessionCookie);
    expect(allowed.headers.get("x-middleware-next")).toBe("1");
    expect(callsTo(fetchMock, "/api/v1/auth/me")).toHaveLength(0);

    // An hour later inventory-api says the token is gone: the proxy ends the session and
    // clears the cookie in the same response.
    advance(RECHECK_INTERVAL_MS + 1);
    revokeToken();
    const denied = await visit("/my-work", sessionCookie);
    expect(denied.status).toBe(307);
    expect(new URL(denied.headers.get("location") ?? "").pathname).toBe("/login");
    expect(callsTo(fetchMock, "/api/v1/auth/me")).toHaveLength(1);
    const cleared = denied.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(cleared).toMatch(new RegExp(`^${SESSION_COOKIE}=;`));
  });

  it("refuses an OWNER with access_denied, sets no session and drops the token", async () => {
    const { signIn, fetchMock } = setup("OWNER");

    const response = await signIn();
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("error")).toBe("CredentialsSignin");
    expect(location.searchParams.get("code")).toBe("access_denied");
    expect(cookiePairs(response).some((pair) => pair.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    expect(callsTo(fetchMock, "/api/v1/auth/logout")).toHaveLength(1);
  });
});
