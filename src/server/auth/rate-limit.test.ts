import { describe, expect, it } from "vitest";

import { memoryAttemptStore } from "@/test/stockkart-fakes";

import {
  clientIpFrom,
  createRateLimiter,
  MAX_FAILURES_PER_EMAIL,
  RATE_LIMIT_WINDOW_MS,
} from "./rate-limit";

function ipOf(headers: Record<string, string>): string {
  return clientIpFrom(new Headers(headers));
}

describe("clientIpFrom()", () => {
  it("prefers x-real-ip, then the first x-forwarded-for entry", () => {
    expect(ipOf({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "198.51.100.1" })).toBe(
      "203.0.113.5",
    );
    expect(ipOf({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" })).toBe("198.51.100.1");
  });

  it("puts requests without either header into one shared bucket", () => {
    expect(ipOf({})).toBe("unknown");
    expect(ipOf({ "x-real-ip": "  " })).toBe("unknown");
  });

  it("buckets IPv6 addresses by /64", () => {
    const a = ipOf({ "x-real-ip": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" });
    const b = ipOf({ "x-real-ip": "2001:DB8:1:2::1" });
    const c = ipOf({ "x-forwarded-for": "[2001:db8:1:2:ffff::2]" });
    expect(a).toBe("2001:db8:1:2::/64");
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(ipOf({ "x-real-ip": "2001:db8:1:3::1" })).toBe("2001:db8:1:3::/64");
  });

  it("expands compressed and zero-padded IPv6 forms to the same bucket", () => {
    expect(ipOf({ "x-real-ip": "2001:db8::1" })).toBe("2001:db8:0:0::/64");
    expect(ipOf({ "x-real-ip": "2001:0db8:0000:0000:0000:0000:0000:0001" })).toBe(
      "2001:db8:0:0::/64",
    );
    expect(ipOf({ "x-real-ip": "::1" })).toBe("0:0:0:0::/64");
    expect(ipOf({ "x-real-ip": "fe80::1%eth0" })).toBe("fe80:0:0:0::/64");
  });

  it("treats IPv4-mapped IPv6 as the IPv4 address", () => {
    expect(ipOf({ "x-real-ip": "::ffff:192.0.2.1" })).toBe("192.0.2.1");
    expect(ipOf({ "x-real-ip": "::ffff:c000:201" })).toBe("192.0.2.1");
  });

  it("falls back to the raw (length-capped) value for something that is not IPv6", () => {
    expect(ipOf({ "x-real-ip": "1::2::3" })).toBe("1::2::3");
    expect(ipOf({ "x-real-ip": `bad:${"x".repeat(200)}` })).toHaveLength(64);
  });
});

describe("createRateLimiter() with the in-memory store", () => {
  it("refuses a reservation once the email has used its budget, until the window passes", async () => {
    let clock = Date.UTC(2026, 5, 1, 9, 0, 0);
    const limiter = createRateLimiter(memoryAttemptStore(), () => new Date(clock));

    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i += 1) {
      expect(await limiter.reserve("a@example.test", `198.51.100.${i}`)).not.toBeNull();
    }
    expect(await limiter.reserve("a@example.test", "198.51.100.99")).toBeNull();

    clock += RATE_LIMIT_WINDOW_MS + 1;
    expect(await limiter.reserve("a@example.test", "198.51.100.99")).not.toBeNull();
  });

  it("does not count succeeded or released reservations as failures", async () => {
    const store = memoryAttemptStore();
    const limiter = createRateLimiter(store);
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL * 2; i += 1) {
      const reservation = await limiter.reserve("b@example.test", "192.0.2.1");
      expect(reservation).not.toBeNull();
      await (i % 2 === 0 ? reservation?.succeeded() : reservation?.release());
    }
    expect(store.rows.every((row) => row.success)).toBe(true);
  });
});
