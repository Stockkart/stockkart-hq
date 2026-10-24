import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import proxy from "./proxy";

/**
 * Exercises the real proxy (Auth.js `auth()` wrapper + access policy) end to end with no
 * valid session cookie. No database or inventory-api is contacted: an anonymous request
 * never reaches either.
 */
async function send(path: string, cookie?: string): Promise<Response> {
  const request = new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });
  const response = await proxy(request, { params: Promise.resolve({}) });
  if (!response) throw new Error("proxy returned no response");
  return response;
}

function locationPath(response: Response): string {
  return new URL(response.headers.get("location") ?? "", "http://localhost:3000").pathname;
}

describe("proxy (middleware) denies anonymous access", () => {
  it("redirects / to /login", async () => {
    const response = await send("/");
    expect(response.status).toBe(307);
    expect(locationPath(response)).toBe("/login");
  });

  it("redirects /my-work to /login", async () => {
    const response = await send("/my-work");
    expect(response.status).toBe(307);
    expect(locationPath(response)).toBe("/login");
  });

  it.each(["/api/files/123", "/api/files/thumbnail/diagram/123"])(
    "answers the file route %s with 401 (S-5, S-10)",
    async (path) => {
      const response = await send(path);
      expect(response.status).toBe(401);
    },
  );

  it("rejects a forged session cookie", async () => {
    const response = await send("/my-work", "authjs.session-token=not-a-real-jwe");
    expect(response.status).toBe(307);
    expect(locationPath(response)).toBe("/login");
  });

  it("lets /login through", async () => {
    const response = await send("/login");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each([
    "/api/auth/session",
    "/api/auth/csrf",
    "/api/auth/providers",
    "/api/webhooks/github",
    // NTF-2: they authenticate themselves (cron secret, unsubscribe token).
    "/api/cron/digest",
    // COST-7 monthly jobs: the cron secret.
    "/api/cron/monthly",
    "/unsubscribe",
  ])("lets %s through without a session", async (path) => {
    const response = await send(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each([
    ["/api/cron/digest/x", 401],
    ["/api/cron/other", 401],
    ["/unsubscribe/x", 307],
    // Near misses stay gated too: the exemptions are exact, case and slash included.
    ["/api/cron/digest/", 401],
    ["/api/cron/monthly/", 401],
    ["/api/cron/monthly/x", 401],
    ["/api/cron", 401],
    ["/unsubscribe/", 307],
    ["/Unsubscribe", 307],
    ["/unsubscribex", 307],
  ])("keeps %s behind the session gate (exact-path exemptions)", async (path, status) => {
    expect((await send(path)).status).toBe(status);
  });

  // The P2 slices' pages (roadmap, releases, incidents, services, CSV import, doc comments)
  // added no exemptions: each redirects an anonymous visitor to /login.
  it.each([
    "/STK/roadmap",
    "/STK/releases",
    "/STK/releases/3f1e2d3c-4b5a-4968-8776-5544332211aa",
    "/STK/incidents",
    "/STK/incidents/INC-1",
    "/STK/services",
    "/STK/services/api",
    "/STK/settings?tab=import",
    "/STK/docs/3f1e2d3c-4b5a-4968-8776-5544332211aa",
    "/STK/unknown-section",
  ])("redirects the P2 page %s to /login", async (path) => {
    const response = await send(path);
    expect(response.status).toBe(307);
    expect(locationPath(response)).toBe("/login");
  });
});
