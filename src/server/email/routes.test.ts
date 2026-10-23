import { describe, expect, it, vi } from "vitest";

import { type DigestJob } from "./digest";
import { createCronDigestHandler, createUnsubscribeHandlers } from "./routes";

const SECRET = "s".repeat(48);
const TOKEN = "A".repeat(42) + "b";
const ORIGIN = "https://hq.example.test";

function cron(secret: string | undefined, job: DigestJob | null) {
  return createCronDigestHandler({ secret: () => secret, job: () => job });
}

const fakeJob = () => {
  const run = vi.fn(async () => ({
    due: 1,
    sent: 1,
    skipped: 0,
    failed: 0,
    busy: 0,
    deferred: 0,
  }));
  return { job: { run }, run };
};

const request = (method: string, authorization?: string) =>
  new Request(`${ORIGIN}/api/cron/digest`, {
    method,
    headers: authorization ? { authorization } : {},
  });

describe("/api/cron/digest (NTF-2)", () => {
  it("answers 503 and runs nothing without CRON_SECRET", async () => {
    const { job, run } = fakeJob();
    const response = await cron(undefined, job)(request("GET", `Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ["no header", undefined],
    ["a wrong secret", "Bearer wrong-secret-wrong-secret-wrong-secret"],
  ])("answers 401 to %s", async (_label, header) => {
    const { job, run } = fakeJob();
    const response = await cron(SECRET, job)(request("GET", header));
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["GET", "POST"])(
    "runs the job for %s with the right secret (Vercel uses GET)",
    async (method) => {
      const { job, run } = fakeJob();
      const response = await cron(SECRET, job)(request(method, `Bearer ${SECRET}`));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        due: 1,
        sent: 1,
        skipped: 0,
        failed: 0,
        busy: 0,
        deferred: 0,
      });
      expect(run).toHaveBeenCalledTimes(1);
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("answers 503 when email is not set up (fail closed), after checking the secret", async () => {
    expect((await cron(SECRET, null)(request("GET", `Bearer ${SECRET}`))).status).toBe(503);
    expect((await cron(SECRET, null)(request("GET"))).status).toBe(401);
  });
});

describe("/unsubscribe (NTF-2, RFC 8058)", () => {
  function handlers(outcome: "done" | "rate_limited" = "done") {
    const unsubscribe = vi.fn(async () => outcome);
    return {
      unsubscribe,
      routes: createUnsubscribeHandlers({
        service: () => ({ unsubscribe }),
        clientIp: () => "203.0.113.9",
      }),
    };
  }

  it("GET only asks: it shows a POST form and never unsubscribes", async () => {
    const { routes, unsubscribe } = handlers();
    const response = routes.GET(new Request(`${ORIGIN}/unsubscribe?token=${TOKEN}`));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Unsubscribe?");
    expect(html).toContain(`<form method="post" action="/unsubscribe?token=${TOKEN}">`);
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("GET with a malformed token reflects nothing", async () => {
    const { routes } = handlers();
    const response = routes.GET(new Request(`${ORIGIN}/unsubscribe?token=%22%3E%3Cscript%3E`));
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<form");
  });

  it("POST unsubscribes with the token from the URL and the client's IP bucket", async () => {
    const { routes, unsubscribe } = handlers();
    const response = await routes.POST(
      new Request(`${ORIGIN}/unsubscribe?token=${TOKEN}`, {
        method: "POST",
        body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("If this link was valid");
    expect(unsubscribe).toHaveBeenCalledWith(TOKEN, "203.0.113.9");
  });

  it("answers an unknown token exactly like a valid one (nothing about the account)", async () => {
    const { routes } = handlers();
    const known = await routes.POST(
      new Request(`${ORIGIN}/unsubscribe?token=${TOKEN}`, { method: "POST" }),
    );
    const unknown = await routes.POST(
      new Request(`${ORIGIN}/unsubscribe?token=nope`, { method: "POST" }),
    );
    expect(unknown.status).toBe(known.status);
    expect(await unknown.text()).toBe(await known.text());
  });

  it("answers 429 when the IP is rate limited", async () => {
    const { routes } = handlers("rate_limited");
    const response = await routes.POST(
      new Request(`${ORIGIN}/unsubscribe?token=${TOKEN}`, { method: "POST" }),
    );
    expect(response.status).toBe(429);
  });
});
