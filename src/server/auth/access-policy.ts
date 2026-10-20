import type { Session } from "next-auth";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Default-deny routing policy (S-1, AUTH-5), run by `src/proxy.ts` on every request.
 *
 * Only the paths below are reachable without a session. Anything not listed (including
 * routes added later) requires a session, so nobody has to remember to protect new routes.
 * This is a first gate only: pages, server actions and route handlers re-check with
 * `requireSession()` (S-2), because a proxy alone is not trusted.
 */

/** Exact public paths. */
const PUBLIC_PATHS = new Set<string>([
  "/login",
  // Signature-verified GitHub webhook (GH-1): the route authenticates every delivery itself
  // (HMAC-SHA256, fails closed without GITHUB_WEBHOOK_SECRET).
  "/api/webhooks/github",
  // Static files from /public and framework metadata.
  "/favicon.ico",
  "/robots.txt",
]);

/** Public path prefixes. Each must end with "/" so "/api/authx" does not match "/api/auth". */
const PUBLIC_PREFIXES = [
  // Auth.js's own endpoints: csrf, session, providers, signin/callback, signout.
  "/api/auth/",
  // Next.js build output (hashed JS/CSS chunks, fonts, optimised images). No user data.
  "/_next/static/",
  "/_next/image/",
] as const;

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export type AuthenticatedRequest = NextRequest & { auth: Session | null };

export function hasValidSession(session: Session | null | undefined): boolean {
  return typeof session?.user?.id === "string" && session.user.id.length > 0;
}

export function unauthorizedJson(): NextResponse {
  return NextResponse.json(
    { error: "unauthorized", message: "Sign in required" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

export function handleRequest(request: AuthenticatedRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) return NextResponse.next();
  if (hasValidSession(request.auth)) return NextResponse.next();

  if (isApiPath(pathname)) return unauthorizedJson();

  const loginUrl = new URL("/login", request.nextUrl.origin);
  if (pathname !== "/") loginUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

/**
 * Only same-origin relative paths are accepted as post-login destinations, so a crafted
 * `callbackUrl` cannot turn the login page into an open redirect.
 */
export function safeCallbackPath(value: unknown, fallback = "/my-work"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const url = new URL(value, "http://hq.invalid");
    if (url.origin !== "http://hq.invalid") return fallback;
    if (url.pathname === "/login") return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}
