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

  it("answers an /api route with 401", async () => {
    const response = await send("/api/files/123");
    expect(response.status).toBe(401);
  });

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

  it.each(["/api/auth/session", "/api/auth/csrf", "/api/auth/providers", "/api/webhooks/github"])(
    "lets %s through without a session",
    async (path) => {
      const response = await send(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );
});
