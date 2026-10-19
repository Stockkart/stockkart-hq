import type { Session } from "next-auth";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  handleRequest,
  isPublicPath,
  safeCallbackPath,
  type AuthenticatedRequest,
} from "./access-policy";

const ORIGIN = "http://localhost:3000";

function requestFor(path: string, auth: Session | null): AuthenticatedRequest {
  return Object.assign(new NextRequest(`${ORIGIN}${path}`), { auth });
}

const session: Session = {
  expires: "2026-06-02T09:00:00.000Z",
  user: { id: "hq-1", name: "Test Staff", email: "staff@example.test" },
};

describe("default-deny access policy", () => {
  it("redirects an anonymous visit to / to /login", () => {
    const response = handleRequest(requestFor("/", null));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login`);
  });

  it("redirects an anonymous visit to /my-work to /login and remembers where to go back", () => {
    const response = handleRequest(requestFor("/my-work?tab=1", null));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("callbackUrl")).toBe("/my-work?tab=1");
  });

  it.each(["/api/files/abc", "/api/anything", "/api"])(
    "answers an anonymous API request to %s with 401 JSON",
    async (path) => {
      const response = handleRequest(requestFor(path, null));
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: "unauthorized" });
    },
  );

  it("denies routes that do not exist yet (new routes are protected by default)", () => {
    expect(handleRequest(requestFor("/STK/board", null)).status).toBe(307);
    expect(handleRequest(requestFor("/settings", null)).status).toBe(307);
  });

  it.each([
    "/login",
    "/api/auth/session",
    "/api/auth/csrf",
    "/api/webhooks/github",
    "/_next/static/chunks/a.js",
  ])("lets anonymous requests reach public path %s", (path) => {
    expect(isPublicPath(path)).toBe(true);
    expect(handleRequest(requestFor(path, null)).headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/api/authx", "/api/auth", "/login/extra", "/api/webhooks/github/x", "/_next/data/x"])(
    "does not treat look-alike path %s as public",
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    },
  );

  it("lets a signed-in user through", () => {
    for (const path of ["/", "/my-work", "/api/files/abc"]) {
      expect(handleRequest(requestFor(path, session)).headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("treats a session without a user id as anonymous", () => {
    const broken: Session = { expires: session.expires, user: { id: "", name: "", email: "" } };
    expect(handleRequest(requestFor("/my-work", broken)).status).toBe(307);
  });
});

describe("safeCallbackPath", () => {
  it.each([
    ["/my-work", "/my-work"],
    ["/STK/issues?status=open", "/STK/issues?status=open"],
    ["https://evil.example/", "/my-work"],
    ["//evil.example/x", "/my-work"],
    ["/\\evil.example", "/my-work"],
    ["javascript:alert(1)", "/my-work"],
    ["/login", "/my-work"],
    [undefined, "/my-work"],
  ])("maps %s to %s", (input, expected) => {
    expect(safeCallbackPath(input)).toBe(expected);
  });
});
