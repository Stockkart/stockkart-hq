// Relative (not `@/`) so the script runs under plain tsx.
import { LOOPBACK_HOSTS } from "../db/database-url";

/**
 * Helpers for `scripts/send-test-webhook.ts` (manual local testing of GH-1). Synthetic
 * payloads only; nothing here talks to GitHub.
 */

export const DEFAULT_WEBHOOK_BASE = "http://127.0.0.1:3000";
export const WEBHOOK_PATH = "/api/webhooks/github";

/**
 * The webhook URL for a base URL. Only https, or plain http to this machine, so a signed
 * delivery (and the secret's HMAC) never crosses a network unencrypted.
 */
export function webhookTarget(base: string): URL {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`Not a URL: ${base}`);
  }
  const local = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new Error("Use an https:// URL, or http://127.0.0.1 / http://localhost");
  }
  if (url.username || url.password) throw new Error("The URL must not contain credentials");
  return new URL(WEBHOOK_PATH, url);
}

export const SAMPLE_EVENTS = ["ping", "create", "push", "pr-opened", "pr-merged"] as const;
export type SampleEvent = (typeof SAMPLE_EVENTS)[number];

const REPO = "Stockkart/inventory-api";

function repository() {
  return {
    full_name: REPO,
    owner: { login: "Stockkart" },
    html_url: `https://github.com/${REPO}`,
    default_branch: "main",
  };
}

/** `[X-GitHub-Event, payload]` for a sample delivery mentioning `issueKey` (e.g. STK-1). */
export function samplePayload(
  sample: SampleEvent,
  issueKey: string,
  prNumber = 1,
): [string, unknown] {
  const branch = `${issueKey.toLowerCase()}-test-webhook`;
  const sha = Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join(
    "",
  );
  const pullRequest = (merged: boolean) => ({
    action: merged ? "closed" : "opened",
    number: prNumber,
    pull_request: {
      number: prNumber,
      title: `${issueKey}: test webhook`,
      body: merged ? `Fixes ${issueKey}` : "Synthetic PR from scripts/send-test-webhook.ts",
      html_url: `https://github.com/${REPO}/pull/${prNumber}`,
      state: merged ? "closed" : "open",
      draft: false,
      merged,
      merged_at: merged ? new Date().toISOString() : null,
      user: { login: "octocat" },
      merged_by: merged ? { login: "octocat" } : null,
      head: { ref: branch, repo: { full_name: REPO } },
      base: { ref: "main" },
    },
    repository: repository(),
  });
  switch (sample) {
    case "ping":
      return ["ping", { zen: "Design for failure.", hook_id: 1 }];
    case "create":
      return ["create", { ref: branch, ref_type: "branch", repository: repository() }];
    case "push":
      return [
        "push",
        {
          ref: `refs/heads/${branch}`,
          deleted: false,
          commits: [
            {
              id: sha,
              message: `${issueKey}: synthetic commit`,
              url: `https://github.com/${REPO}/commit/${sha}`,
              author: { username: "octocat" },
            },
          ],
          repository: repository(),
        },
      ];
    case "pr-opened":
      return ["pull_request", pullRequest(false)];
    case "pr-merged":
      return ["pull_request", pullRequest(true)];
  }
}
