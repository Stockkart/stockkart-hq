import { signGithubPayload } from "@/server/github/signature";

/**
 * Synthetic GitHub webhook payloads and signed requests for tests (no real data). Only the
 * fields HQ reads, plus a few it must ignore.
 */

export const TEST_WEBHOOK_SECRET = "test-webhook-secret-not-used-anywhere-real";

export function repository(fullName = "Stockkart/inventory-api", defaultBranch = "main") {
  const [owner = "Stockkart"] = fullName.split("/");
  return {
    id: 1,
    full_name: fullName,
    name: fullName.split("/")[1],
    owner: { login: owner, type: "Organization" },
    html_url: `https://github.com/${fullName}`,
    default_branch: defaultBranch,
    private: true,
  };
}

let shaCounter = 0;
/** A distinct 40-hex sha per call. */
export function sha(): string {
  shaCounter += 1;
  return shaCounter.toString(16).padStart(40, "a");
}

export function commit(message: string, id = sha(), username: string | null = "imf-ali") {
  return {
    id,
    message,
    url: `https://github.com/Stockkart/inventory-api/commit/${id}`,
    author: username ? { name: "Some Dev", email: "dev@example.test", username } : { name: "x" },
    distinct: true,
  };
}

export function pushPayload(
  options: { ref?: string; commits?: unknown[]; repo?: string; deleted?: boolean } = {},
) {
  return {
    ref: options.ref ?? "refs/heads/main",
    before: "0".repeat(40),
    after: "1".repeat(40),
    deleted: options.deleted ?? false,
    commits: options.commits ?? [],
    repository: repository(options.repo),
    sender: { login: "imf-ali" },
  };
}

export interface PrOptions {
  action?: string;
  number?: number;
  title?: string;
  body?: string | null;
  state?: "open" | "closed";
  draft?: boolean;
  merged?: boolean;
  head?: string;
  base?: string;
  repo?: string;
  defaultBranch?: string;
  author?: string;
  mergedBy?: string | null;
}

export function pullRequestPayload(options: PrOptions = {}) {
  const repo = options.repo ?? "Stockkart/inventory-api";
  const number = options.number ?? 118;
  const merged = options.merged ?? false;
  return {
    action: options.action ?? "opened",
    number,
    pull_request: {
      number,
      title: options.title ?? "Fix the OCR worker",
      body: options.body === undefined ? null : options.body,
      html_url: `https://github.com/${repo}/pull/${number}`,
      state: options.state ?? "open",
      draft: options.draft ?? false,
      merged,
      merged_at: merged ? "2026-01-02T03:04:05Z" : null,
      user: { login: options.author ?? "imf-ali" },
      merged_by:
        merged && options.mergedBy !== null ? { login: options.mergedBy ?? "imf-ali" } : null,
      head: { ref: options.head ?? "feature/misc", repo: { full_name: repo } },
      base: { ref: options.base ?? "main" },
    },
    repository: repository(repo, options.defaultBranch),
    sender: { login: "imf-ali" },
  };
}

export function createPayload(ref: string, refType = "branch", repo?: string) {
  return { ref, ref_type: refType, master_branch: "main", repository: repository(repo) };
}

let deliveryCounter = 0;
export function deliveryId(): string {
  deliveryCounter += 1;
  return `00000000-0000-4000-8000-${deliveryCounter.toString().padStart(12, "0")}`;
}

/** A webhook request signed with `secret` (or with the given signature header). */
export function webhookRequest(
  event: string,
  payload: unknown,
  options: { secret?: string; signature?: string | null; delivery?: string; body?: string } = {},
): Request {
  const body = options.body ?? JSON.stringify(payload);
  const headers = new Headers({
    "content-type": "application/json",
    "x-github-event": event,
    "x-github-delivery": options.delivery ?? deliveryId(),
  });
  const signature =
    options.signature === undefined
      ? signGithubPayload(options.secret ?? TEST_WEBHOOK_SECRET, body)
      : options.signature;
  if (signature !== null) headers.set("x-hub-signature-256", signature);
  return new Request("http://127.0.0.1:3000/api/webhooks/github", {
    method: "POST",
    headers,
    body,
  });
}
