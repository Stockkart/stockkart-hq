import { env } from "@/env";
import {
  DOC_PAGE,
  ISSUE_PAGE,
  ISSUE_VIEWS,
  PROJECT_SETTINGS,
  refreshPages,
} from "@/server/actions/refresh";
import { createGithubWebhookHandler } from "@/server/github/webhook";
import { githubService } from "@/server/services";

/**
 * GitHub org webhook (GH-1…GH-3). Public in the proxy because GitHub cannot hold a session;
 * instead every request must carry a valid `X-Hub-Signature-256` HMAC of its raw body,
 * verified with a constant-time compare BEFORE the payload is parsed (S-4). Without
 * GITHUB_WEBHOOK_SECRET it answers 503 and does nothing (fail closed). See
 * `server/github/webhook.ts` for the full order of checks.
 *
 * DOC-14: deliveries from HANDBOOK_REPO also update the docs' handbook sync state (same
 * statement, same dedupe); this route never calls the GitHub API.
 */
export const POST = createGithubWebhookHandler({
  secret: () => env.GITHUB_WEBHOOK_SECRET,
  apply: (plan) => githubService.applyDelivery(plan),
  handbookRepo: () => env.HANDBOOK_REPO,
  // A status change shows on every issue view; new links only on the issue page; handbook
  // sync state on the doc pages and the settings Handbook tab.
  refresh: (result) =>
    refreshPages(
      ...(result.moved > 0
        ? ISSUE_VIEWS
        : result.linked > 0 || result.updated > 0
          ? [ISSUE_PAGE]
          : []),
      ...((result.handbook ?? 0) > 0 ? [DOC_PAGE, PROJECT_SETTINGS] : []),
    ),
});
