import { DEFAULT_HANDBOOK_REPO } from "./constants";

/**
 * DOC-14 handbook GitHub failures as people read them. Isomorphic: the GitHub client builds
 * its error messages with it, and Settings → Handbook turns a stored
 * `handbook_publications.error_code` back into a reason.
 *
 * A failed request's code is `<kind>.<status>` (`installation_token.422`, `update_ref.timeout`
 * …), within `HANDBOOK_ERROR_CODE_REGEX_SOURCE`. Rows written before that hold
 * `github_<status>`, which still reads as "GitHub refused a request (HTTP n)".
 *
 * The client may look at GitHub's JSON error body to pick a `GithubFailureHint`, and nothing
 * else: the body itself (which can echo inputs) is never stored, logged or shown.
 */

/** Every GitHub request the handbook client makes (the `kind` in logs and error codes). */
export const HANDBOOK_GITHUB_REQUEST_KINDS = [
  "installation_token",
  "get_repo",
  "get_ref",
  "get_file",
  "get_blob",
  "list_tree",
  "get_commit",
  "create_blob",
  "create_tree",
  "create_commit",
  "update_ref",
  "create_branch",
  "open_pull_request",
  "get_pull_request",
] as const;
export type HandbookGithubRequestKind = (typeof HANDBOOK_GITHUB_REQUEST_KINDS)[number];

/** What GitHub's error body said, reduced to a known case ("other" = read, none matched). */
export const GITHUB_FAILURE_HINTS = [
  "ref_exists",
  "no_commits",
  "pr_exists",
  "rate_limited",
  "other",
] as const;
export type GithubFailureHint = (typeof GITHUB_FAILURE_HINTS)[number];

/** A request that got no HTTP answer. */
export type GithubNoAnswer = "timeout" | "network";

export function handbookGithubErrorCode(
  kind: HandbookGithubRequestKind,
  status: number | GithubNoAnswer,
): string {
  return `${kind}.${status}`;
}

export interface ParsedHandbookErrorCode {
  /** Null for the old `github_<status>` codes. */
  kind: HandbookGithubRequestKind | null;
  status: number | GithubNoAnswer;
}

/** `<kind>.<status>` (or the old `github_<status>`), or null for any other code. */
export function parseHandbookErrorCode(code: string): ParsedHandbookErrorCode | null {
  const match = /^(?:([a-z_]+)\.|github_)([1-5][0-9]{2}|timeout|network)$/.exec(code);
  if (!match) return null;
  const [, prefix, status = ""] = match;
  const kind =
    prefix === undefined ? null : HANDBOOK_GITHUB_REQUEST_KINDS.find((item) => item === prefix);
  if (kind === undefined) return null;
  const parsed: number | GithubNoAnswer =
    status === "timeout" || status === "network" ? status : Number(status);
  return { kind, status: parsed };
}

export const GITHUB_KEY_MESSAGE = "The GitHub App private key or App ID is wrong.";
export const GITHUB_BUSY_MESSAGE = "GitHub is busy; try again in a minute.";
export const GITHUB_NOT_FOUND_MESSAGE = "The handbook repo or its default branch wasn't found.";
export const GITHUB_BRANCH_EXISTS_MESSAGE = "A branch with this name already exists; try again.";
export const GITHUB_NO_COMMITS_MESSAGE = "Nothing changed: the handbook already has this content.";
export const GITHUB_PR_EXISTS_MESSAGE = "A PR for this branch is already open.";
export const GITHUB_PR_REFUSED_MESSAGE = "GitHub refused to open the PR.";
export const GITHUB_REF_MOVED_MESSAGE = "The handbook changed while publishing; try again.";

/** The installation cannot reach the repo: not selected, a permission missing or pending. */
export function githubAccessMessage(repo: string = DEFAULT_HANDBOOK_REPO): string {
  const [owner = "Stockkart", name = repo] = repo.split("/");
  return (
    `The GitHub App can't get access to ${repo}. On GitHub, open the ${owner} org → ` +
    `Settings → GitHub Apps → your App → Configure: make sure ${name} is selected, and ` +
    "accept any pending permission request. The App needs Contents: Read and write, " +
    "Pull requests: Read and write, Metadata: Read."
  );
}

/** Codes that are not a GitHub status (the client's own checks, publish bookkeeping). */
const OTHER_CODES: Record<string, string | ((repo: string) => string)> = {
  bad_private_key: GITHUB_KEY_MESSAGE,
  token_scope: githubAccessMessage,
  repo_scope: (repo) =>
    `GitHub answered for another repo than ${repo} (renamed or moved?); HQ only uses ${repo}.`,
  github_bad_response: "GitHub sent an answer HQ doesn't understand.",
  blob_mismatch: "GitHub stored different file contents than HQ sent.",
  bad_pr_url: "GitHub returned a PR link outside the handbook repo.",
  file_too_large: "A handbook file is larger than 1 MB.",
  tree_truncated: "The handbook repo is too large to list in one request.",
  not_utf8: "A handbook file isn't UTF-8 text.",
  record_failed: "The PR was opened but HQ couldn't record it.",
  abandoned: "The publish stopped before GitHub opened the PR.",
  not_configured: "Handbook sync isn't set up.",
};

/**
 * The reason to show for a handbook error code. `hint` is what the client read from GitHub's
 * error body (absent for stored codes: those read as the general case of their kind).
 */
export function describeHandbookError(
  code: string,
  options: { hint?: GithubFailureHint | null; repo?: string } = {},
): string {
  const repo = options.repo ?? DEFAULT_HANDBOOK_REPO;
  const hint = options.hint ?? null;
  const parsed = parseHandbookErrorCode(code);
  if (!parsed) {
    const known = OTHER_CODES[code];
    if (typeof known === "function") return known(repo);
    return known ?? "Handbook sync failed.";
  }
  const { kind, status } = parsed;
  const what = kind ?? "GitHub";
  if (status === "timeout") return `GitHub didn't answer the ${what} request in time.`;
  if (status === "network") return `GitHub couldn't be reached for the ${what} request.`;
  // GitHub also answers 403 for its secondary rate limits.
  if (status === 429 || status >= 500 || hint === "rate_limited") return GITHUB_BUSY_MESSAGE;
  if (kind === "installation_token") {
    if (status === 401) return GITHUB_KEY_MESSAGE;
    if (status === 403 || status === 404 || status === 422) return githubAccessMessage(repo);
  }
  if ((kind === "get_repo" || kind === "get_ref") && status === 404) {
    return GITHUB_NOT_FOUND_MESSAGE;
  }
  // A stored code has no hint; GitHub's create-ref 422 is "Reference already exists".
  if (kind === "create_branch" && status === 422 && (hint === null || hint === "ref_exists")) {
    return GITHUB_BRANCH_EXISTS_MESSAGE;
  }
  if (kind === "open_pull_request" && status === 422) {
    if (hint === "no_commits") return GITHUB_NO_COMMITS_MESSAGE;
    if (hint === "pr_exists") return GITHUB_PR_EXISTS_MESSAGE;
    return GITHUB_PR_REFUSED_MESSAGE;
  }
  if (kind === "update_ref" && status === 422) return GITHUB_REF_MOVED_MESSAGE;
  if (kind === null) return `GitHub refused a request (HTTP ${status}).`;
  return `GitHub refused the ${kind} request (HTTP ${status}).`;
}

/** The reason with its code, as actions, toasts and dialogs show it. */
export function handbookErrorText(
  code: string,
  options: { hint?: GithubFailureHint | null; repo?: string } = {},
): string {
  return withErrorCode(describeHandbookError(code, options), code);
}

/** `Reason (code).` */
export function withErrorCode(reason: string, code: string): string {
  return `${reason.replace(/\.$/, "")} (${code}).`;
}
