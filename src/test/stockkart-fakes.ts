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

/**
 * In-memory replacement for the Postgres login_attempts table, with the same reservation
 * semantics. The count and the insert in `reserve()` run synchronously with no `await`
 * between them, so (like the advisory-locked transaction in Postgres) concurrent callers
 * cannot interleave between the limit check and the write.
 */
export function memoryAttemptStore(): LoginAttemptStore & {
  rows: { id: string; key: string; success: boolean; at: Date }[];
} {
  const rows: { id: string; key: string; success: boolean; at: Date }[] = [];
  let nextId = 1;
  const failures = (key: string, since: Date) =>
    rows.filter((row) => row.key === key && !row.success && row.at > since).length;
  return {
    rows,
    async reserve(email, ip, since, at) {
      if (failures(email.key, since) >= email.max || failures(ip.key, since) >= ip.max) {
        return null;
      }
      const reserved = [email.key, ip.key].map((key) => ({
        id: `attempt-${nextId++}`,
        key,
        success: false,
        at,
      }));
      rows.push(...reserved);
      return reserved.map((row) => row.id);
    },
    async markSuccess(ids) {
      for (const row of rows) if (ids.includes(row.id)) row.success = true;
    },
    async release(ids) {
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i];
        if (row && ids.includes(row.id)) rows.splice(i, 1);
      }
    },
  };
}

export function memoryUserRepository(): UserRepository & {
  upserts: UpsertUserInput[];
  /** S-3 "sign out everywhere": bumps the stored session version for an HQ user id. */
  bumpSessionVersion(hqUserId: string): void;
  /** Makes `getSessionVersion` reject, as if the database were unreachable. */
  failReads(fail: boolean): void;
} {
  const upserts: UpsertUserInput[] = [];
  const byStockkartId = new Map<string, HqUser>();
  let readsFail = false;
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
    async getSessionVersion(hqUserId) {
      if (readsFail) throw new Error("db down");
      for (const user of byStockkartId.values()) {
        if (user.id === hqUserId) return user.sessionVersion;
      }
      return null;
    },
    bumpSessionVersion(hqUserId) {
      for (const user of byStockkartId.values()) {
        if (user.id === hqUserId) user.sessionVersion += 1;
      }
    },
    failReads(fail) {
      readsFail = fail;
    },
  };
}

export function requestFromIp(ip: string): Request {
  return new Request("http://127.0.0.1:3000/api/auth/callback/credentials", {
    method: "POST",
    headers: { "x-real-ip": ip },
  });
}
