import { env } from "@/env";
import { ISSUE_PAGE, ISSUE_VIEWS, refreshPages } from "@/server/actions/refresh";
import { createGithubWebhookHandler } from "@/server/github/webhook";
import { githubService } from "@/server/services";

/**
 * GitHub org webhook (GH-1…GH-3). Public in the proxy because GitHub cannot hold a session;
 * instead every request must carry a valid `X-Hub-Signature-256` HMAC of its raw body,
 * verified with a constant-time compare BEFORE the payload is parsed (S-4). Without
 * GITHUB_WEBHOOK_SECRET it answers 503 and does nothing (fail closed). See
 * `server/github/webhook.ts` for the full order of checks.
 */
export const POST = createGithubWebhookHandler({
  secret: () => env.GITHUB_WEBHOOK_SECRET,
  apply: (plan) => githubService.applyDelivery(plan),
  // A status change shows on every issue view; new links only on the issue page.
  refresh: (result) => refreshPages(...(result.moved > 0 ? ISSUE_VIEWS : [ISSUE_PAGE])),
});
