import { describe, expect, it, vi } from "vitest";

import { createTimedFetch, type RequestDbStats, statementCount } from "./query-log";

describe("statementCount", () => {
  it("counts a batch's statements and treats anything else as one", () => {
    expect(statementCount(JSON.stringify({ queries: [{}, {}, {}] }))).toBe(3);
    expect(statementCount(JSON.stringify({ query: "SELECT 1", params: [] }))).toBe(1);
    expect(statementCount("not json")).toBe(1);
    expect(statementCount(undefined)).toBe(1);
  });
});

describe("createTimedFetch (HQ_LOG_QUERIES)", () => {
  it("logs round trips with running totals, and never the SQL or its parameters", async () => {
    const lines: string[] = [];
    const stats: RequestDbStats = {
      id: "req1",
      roundTrips: 0,
      statements: 0,
      totalMs: 0,
      startedAt: null,
    };
    let clock = 0;
    const base = vi.fn(async () => {
      clock += 180;
      return new Response("{}");
    });
    const timed = createTimedFetch(base, {
      log: (line) => lines.push(line),
      stats: () => stats,
      now: () => clock,
    });
    const secret = "SELECT secret_column FROM users WHERE email = 'ada@example.test'";
    await timed("https://neon.test/sql", {
      method: "POST",
      body: JSON.stringify({ queries: [{ query: secret, params: ["p"] }, { query: secret }] }),
    });
    await timed("https://neon.test/sql", { body: JSON.stringify({ query: secret }) });

    expect(base).toHaveBeenCalledTimes(2);
    expect(stats).toMatchObject({ roundTrips: 2, statements: 3, totalMs: 360 });
    expect(lines).toEqual([
      "[db] req1 round trip 1: 2 statements in 180 ms · request so far: 1 round trips, 2 statements, 180 ms wall",
      "[db] req1 round trip 2: 1 statement in 180 ms · request so far: 2 round trips, 3 statements, 360 ms wall",
    ]);
    expect(lines.join("\n")).not.toContain("secret_column");
    expect(lines.join("\n")).not.toContain("ada@example.test");
  });
});
