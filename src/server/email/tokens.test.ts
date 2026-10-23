import * as crypto from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof crypto>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const {
  constantTimeEqual,
  hashToken,
  isUnsubscribeToken,
  newUnsubscribeToken,
  verifyCronAuthorization,
} = await import("./tokens");

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";

describe("unsubscribe tokens (NTF-2)", () => {
  it("are 32 random bytes; only the sha-256 hex is meant to be stored", () => {
    const first = newUnsubscribeToken();
    const second = newUnsubscribeToken();
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(first.token, "base64url")).toHaveLength(32);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.hash).toBe(hashToken(first.token));
    expect(first.hash).not.toContain(first.token);
    // Rotation: every digest gets a different token and hash.
    expect(second.token).not.toBe(first.token);
    expect(second.hash).not.toBe(first.hash);
    expect(isUnsubscribeToken(first.token)).toBe(true);
    expect(isUnsubscribeToken(`${first.token}x`)).toBe(false);
    expect(isUnsubscribeToken(null)).toBe(false);
  });

  it("compares in constant time, whatever the lengths", () => {
    const timingSafeEqual = vi.mocked(crypto.timingSafeEqual);
    timingSafeEqual.mockClear();
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual).toHaveBeenCalledTimes(3);
  });
});

describe("cron authorization (NTF-2)", () => {
  it("accepts exactly `Bearer <CRON_SECRET>`, through the constant-time compare", () => {
    const timingSafeEqual = vi.mocked(crypto.timingSafeEqual);
    timingSafeEqual.mockClear();
    expect(verifyCronAuthorization(SECRET, `Bearer ${SECRET}`)).toBe(true);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no header", null],
    ["a wrong secret", `Bearer ${SECRET.slice(0, -1)}x`],
    ["a prefix of the secret", `Bearer ${SECRET.slice(0, 10)}`],
    ["another scheme", `Basic ${SECRET}`],
    ["the bare secret", SECRET],
    ["extra words", `Bearer ${SECRET} x`],
  ])("refuses %s", (_label, header) => {
    expect(verifyCronAuthorization(SECRET, header)).toBe(false);
  });

  it("refuses everything without a configured secret", () => {
    expect(verifyCronAuthorization(undefined, "Bearer anything")).toBe(false);
    expect(verifyCronAuthorization("", "Bearer ")).toBe(false);
  });
});
