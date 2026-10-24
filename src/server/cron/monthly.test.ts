import { describe, expect, it, vi } from "vitest";

import { createCronMonthlyHandler } from "./monthly";

const SECRET = "s".repeat(48);

function setup(secret: string | undefined) {
  const run = vi.fn(async () => ({ projects: 1, notified: 2 }));
  const handler = createCronMonthlyHandler({
    secret: () => secret,
    costReminders: () => ({ run }),
  });
  return { handler, run };
}

const request = (method: string, authorization?: string) =>
  new Request("https://hq.example.test/api/cron/monthly", {
    method,
    headers: authorization ? { authorization } : {},
  });

describe("/api/cron/monthly (COST-7)", () => {
  it("answers 503 and runs nothing without CRON_SECRET (fail closed)", async () => {
    const { handler, run } = setup(undefined);
    const response = await handler(request("GET", `Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ["no header", undefined],
    ["a wrong secret", `Bearer ${"t".repeat(48)}`],
    ["the secret as a prefix", `Bearer ${SECRET}x`],
    ["another scheme", `Basic ${SECRET}`],
    ["no scheme", SECRET],
  ])("answers 401 to %s", async (_label, header) => {
    const { handler, run } = setup(SECRET);
    const response = await handler(request("GET", header));
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["GET", "POST"])("runs the jobs for %s with the right secret", async (method) => {
    const { handler, run } = setup(SECRET);
    const response = await handler(request(method, `Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      costReminders: { projects: 1, notified: 2 },
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
