import { vi } from "vitest";

import type { LoginAttemptStore } from "@/server/auth/rate-limit";
import type { HqUser, UpsertUserInput, UserRepository } from "@/server/auth/users";

/** Fake inventory-api base URL. Tests never reach the network: fetch is always mocked. */
export const API_BASE = "https://stockkart-api.test";

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function stockkartUser(role: string, overrides: Record<string, unknown> = {}) {
  return {
    userId: "sk-user-1",
    role,
    shopId: null,
    email: "staff@example.test",
    name: "Test Staff",
    phone: null,
    active: true,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function loginOk(role: string, accessToken = "opaque-token-1") {
  return jsonResponse(200, {
    success: true,
    data: { accessToken, refreshToken: "unused", user: stockkartUser(role), shop: null },
  });
}

export function meOk(role: string, overrides: Record<string, unknown> = {}) {
  return jsonResponse(200, { success: true, data: stockkartUser(role, overrides) });
}

export function apiError(status: number, message = "error") {
  return jsonResponse(status, { success: false, error: message });
}

export function timeoutError(): DOMException {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** A `fetch` mock that routes by path and records every call. */
export function mockFetch(handler: FetchHandler) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return handler(url, init ?? {});
  });
}

export function callsTo(fetchMock: ReturnType<typeof mockFetch>, path: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input) === `${API_BASE}${path}`);
}

/** In-memory replacement for the Postgres login_attempts table. */
export function memoryAttemptStore(): LoginAttemptStore & {
  rows: { key: string; success: boolean; at: Date }[];
} {
  const rows: { key: string; success: boolean; at: Date }[] = [];
  return {
    rows,
    async countFailuresSince(key, since) {
      return rows.filter((row) => row.key === key && !row.success && row.at > since).length;
    },
    async record(keys, success, at) {
      for (const key of keys) rows.push({ key, success, at });
    },
  };
}

export function memoryUserRepository(): UserRepository & { upserts: UpsertUserInput[] } {
  const upserts: UpsertUserInput[] = [];
  const byStockkartId = new Map<string, HqUser>();
  return {
    upserts,
    async upsertOnSignIn(input) {
      upserts.push(input);
      const existing = byStockkartId.get(input.stockkartUserId);
      const user: HqUser = {
        id: existing?.id ?? `hq-${byStockkartId.size + 1}`,
        name: input.name,
        email: input.email,
        sessionVersion: existing?.sessionVersion ?? 0,
      };
      byStockkartId.set(input.stockkartUserId, user);
      return user;
    },
  };
}

export function requestFromIp(ip: string): Request {
  return new Request("http://127.0.0.1:3000/api/auth/callback/credentials", {
    method: "POST",
    headers: { "x-real-ip": ip },
  });
}
