import { beforeEach, describe, expect, it, vi } from "vitest";

import { type DeliveryResult } from "@/server/services/github";
import {
  commit,
  createPayload,
  pullRequestPayload,
  pushPayload,
  TEST_WEBHOOK_SECRET,
  webhookRequest,
} from "@/test/github-fixtures";

import { type DeliveryPlan } from "./plan";
import { signGithubPayload } from "./signature";
import { createGithubWebhookHandler, MAX_BODY_BYTES } from "./webhook";

const applied: DeliveryResult = { duplicate: false, linked: 1, updated: 0, moved: 0 };

function setup(secret: string | undefined) {
  const apply = vi.fn<(plan: DeliveryPlan) => Promise<DeliveryResult>>();
  apply.mockResolvedValue(applied);
  const refresh = vi.fn();
  const log = vi.fn();
  const handler = createGithubWebhookHandler({ secret: () => secret, apply, refresh, log });
  return { handler, apply, refresh, log };
}

const linkingPush = () => pushPayload({ ref: "refs/heads/stk-1-x" });

describe("GitHub webhook (GH-1, S-4)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup(TEST_WEBHOOK_SECRET);
  });

  it("fails closed with 503 when the secret is not configured", async () => {
    ctx = setup(undefined);
    const response = await ctx.handler(webhookRequest("push", linkingPush()));
    expect(response.status).toBe(503);
    expect(ctx.apply).not.toHaveBeenCalled();
    ctx = setup("");
    expect((await ctx.handler(webhookRequest("push", linkingPush()))).status).toBe(503);
  });

  it("accepts a correctly signed delivery and applies it", async () => {
    const response = await ctx.handler(webhookRequest("push", linkingPush()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, linked: 1 });
    expect(ctx.apply).toHaveBeenCalledTimes(1);
    expect(ctx.apply.mock.calls[0]?.[0]).toMatchObject({
      event: "push",
      repo: "Stockkart/inventory-api",
    });
    expect(ctx.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["wrong secret", signGithubPayload("not-the-secret", JSON.stringify(linkingPush()))],
    ["wrong length", "sha256=abcd"],
    ["not hex", `sha256=${"z".repeat(64)}`],
    ["sha1 only", `sha1=${"a".repeat(40)}`],
  ])("rejects a %s signature with 401 before parsing", async (_label, signature) => {
    const parse = vi.spyOn(JSON, "parse");
    const response = await ctx.handler(webhookRequest("push", linkingPush(), { signature }));
    expect(response.status).toBe(401);
    expect(parse).not.toHaveBeenCalled();
    expect(ctx.apply).not.toHaveBeenCalled();
  });

  it("rejects a signature over a different body", async () => {
    const signature = signGithubPayload(TEST_WEBHOOK_SECRET, JSON.stringify(linkingPush()));
    const tampered = JSON.stringify({ ...linkingPush(), ref: "refs/heads/stk-2" });
    const response = await ctx.handler(webhookRequest("push", null, { signature, body: tampered }));
    expect(response.status).toBe(401);
    expect(ctx.apply).not.toHaveBeenCalled();
  });

  it("refuses bodies over 1 MB with 413, signed or not", async () => {
    const huge = JSON.stringify({ ...linkingPush(), padding: "x".repeat(MAX_BODY_BYTES) });
    const response = await ctx.handler(webhookRequest("push", null, { body: huge }));
    expect(response.status).toBe(413);
    expect(ctx.apply).not.toHaveBeenCalled();
  });

  it("refuses a body that streams past the limit without a content-length", async () => {
    const chunk = new Uint8Array(256 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MAX_BODY_BYTES) controller.close();
        else {
          sent += chunk.byteLength;
          controller.enqueue(chunk);
        }
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { "x-hub-signature-256": `sha256=${"a".repeat(64)}`, "x-github-event": "push" },
      body: stream,
      duplex: "half",
    };
    const request = new Request("http://127.0.0.1:3000/api/webhooks/github", init);
    expect((await ctx.handler(request)).status).toBe(413);
  });

  it("answers ping with 200 and ignores other events with 202", async () => {
    const ping = await ctx.handler(webhookRequest("ping", { zen: "hi", hook_id: 1 }));
    expect(ping.status).toBe(200);
    const issues = await ctx.handler(webhookRequest("issues", { action: "opened" }));
    expect(issues.status).toBe(202);
    const tag = await ctx.handler(webhookRequest("create", createPayload("v1.0", "tag")));
    expect(tag.status).toBe(202);
    expect(ctx.apply).not.toHaveBeenCalled();
  });

  it("answers 400 to malformed JSON, an unknown shape or bad headers", async () => {
    expect((await ctx.handler(webhookRequest("push", null, { body: "{not json" }))).status).toBe(
      400,
    );
    expect((await ctx.handler(webhookRequest("push", { ref: 1 }))).status).toBe(400);
    expect(
      (await ctx.handler(webhookRequest("pull_request", { action: "opened", pull_request: {} })))
        .status,
    ).toBe(400);
    expect(
      (await ctx.handler(webhookRequest("push", linkingPush(), { delivery: "../../x" }))).status,
    ).toBe(400);
    expect(ctx.apply).not.toHaveBeenCalled();
  });

  it("ignores repositories outside Stockkart (200, no effect)", async () => {
    const response = await ctx.handler(
      webhookRequest(
        "push",
        pushPayload({ ref: "refs/heads/stk-1-x", repo: "Evil/inventory-api" }),
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ignored: "repository" });
    expect(ctx.apply).not.toHaveBeenCalled();
  });

  it("skips the database when nothing mentions a key", async () => {
    const response = await ctx.handler(
      webhookRequest("push", pushPayload({ ref: "refs/heads/main", commits: [commit("chore")] })),
    );
    expect(response.status).toBe(200);
    expect(ctx.apply).not.toHaveBeenCalled();
  });

  it("still applies a PR without keys, so earlier links get its new state", async () => {
    await ctx.handler(webhookRequest("pull_request", pullRequestPayload({ title: "no key" })));
    expect(ctx.apply).toHaveBeenCalledTimes(1);
  });

  it("reports a redelivery as a duplicate and refreshes nothing", async () => {
    ctx.apply.mockResolvedValue({ duplicate: true, linked: 0, updated: 0, moved: 0 });
    const response = await ctx.handler(webhookRequest("push", linkingPush()));
    expect(await response.json()).toMatchObject({ duplicate: true });
    expect(ctx.refresh).not.toHaveBeenCalled();
  });

  it("never logs the secret, the signature or the payload", async () => {
    const request = webhookRequest(
      "pull_request",
      pullRequestPayload({ title: "STK-1 secret-title", body: "private body text" }),
    );
    const signature = request.headers.get("x-hub-signature-256") ?? "";
    await ctx.handler(request);
    await ctx.handler(webhookRequest("push", linkingPush(), { signature: "sha256=00" }));
    const logged = JSON.stringify(ctx.log.mock.calls);
    expect(logged).not.toContain(TEST_WEBHOOK_SECRET);
    expect(logged).not.toContain(signature.slice(7));
    expect(logged).not.toContain("secret-title");
    expect(logged).not.toContain("private body text");
    expect(logged).toContain("Stockkart/inventory-api");
  });
});
