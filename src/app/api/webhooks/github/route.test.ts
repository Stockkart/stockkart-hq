import { beforeEach, describe, expect, it, vi } from "vitest";

import { pushPayload, TEST_WEBHOOK_SECRET, webhookRequest } from "@/test/github-fixtures";

const env = vi.hoisted((): { GITHUB_WEBHOOK_SECRET: string | undefined } => ({
  GITHUB_WEBHOOK_SECRET: undefined,
}));
vi.mock("@/env", () => ({ env }));
const githubService = vi.hoisted(() => ({ applyDelivery: vi.fn() }));
vi.mock("@/server/services", () => ({ githubService }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

const { POST } = await import("./route");

/** The route's wiring; the checks themselves are tested in server/github/webhook.test.ts. */
describe("POST /api/webhooks/github (GH-1)", () => {
  beforeEach(() => {
    githubService.applyDelivery.mockReset();
    revalidatePath.mockReset();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  it("answers 503 and does nothing while GITHUB_WEBHOOK_SECRET is unset", async () => {
    env.GITHUB_WEBHOOK_SECRET = undefined;
    const response = await POST(webhookRequest("push", pushPayload()));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "not_configured" });
    expect(githubService.applyDelivery).not.toHaveBeenCalled();
  });

  it("verifies with the configured secret and applies through the service", async () => {
    env.GITHUB_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    githubService.applyDelivery.mockResolvedValue({
      duplicate: false,
      linked: 1,
      updated: 0,
      moved: 1,
    });
    const response = await POST(webhookRequest("push", pushPayload({ ref: "refs/heads/stk-1" })));
    expect(response.status).toBe(200);
    expect(githubService.applyDelivery).toHaveBeenCalledTimes(1);
    // A status change refreshes every issue view.
    expect(revalidatePath.mock.calls.map(([path]) => path)).toContain("/[projectKey]/board");

    const forged = await POST(webhookRequest("push", pushPayload(), { secret: "guess" }));
    expect(forged.status).toBe(401);
    expect(githubService.applyDelivery).toHaveBeenCalledTimes(1);
  });
});
