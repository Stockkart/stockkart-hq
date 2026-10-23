/**
 * Handbook two-way sync vocabulary (DOC-12, DOC-14; migration 0006). Isomorphic. The regex
 * sources back the CHECKs in `schema.ts` (POSIX syntax, so no `\d` or lookarounds) and are
 * reused by the Zod schemas of the sync slice.
 */

/** `handbook_publications.state`: a PR HQ opened on the handbook repo through the App. */
export const HANDBOOK_PUBLICATION_STATES = ["open", "merged", "closed", "failed"] as const;
export type HandbookPublicationState = (typeof HANDBOOK_PUBLICATION_STATES)[number];

/** A git blob (or commit) SHA-1, lower-case hex as the GitHub API returns it. */
export const GIT_SHA_REGEX_SOURCE = "^[0-9a-f]{40}$";
export const GIT_SHA_PATTERN = new RegExp(GIT_SHA_REGEX_SOURCE);

/**
 * HQ only ever pushes branches under `hq/` (one segment after the prefix), so the App can
 * never write to a branch a person made, and the name is a valid git ref (no `..`, no
 * trailing `.lock`, also CHECKed).
 */
export const HANDBOOK_BRANCH_PREFIX = "hq/";
export const HANDBOOK_BRANCH_REGEX_SOURCE = "^hq/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$";

export const HANDBOOK_PR_URL_REGEX_SOURCE =
  "^https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[1-9][0-9]{0,9}$";

/**
 * `handbook_publications.error_code`: a short machine code, `<kind>.<status>` for a GitHub
 * request (`installation_token.422` …; older rows hold `github_403` …) or a check's own code
 * (`abandoned`, `bad_path` …). Never a response body.
 */
export const HANDBOOK_ERROR_CODE_REGEX_SOURCE = "^[a-z0-9_.-]{1,64}$";

/** The handbook repo (DOC-14); `HANDBOOK_REPO` may name another repo of the same org. */
export const DEFAULT_HANDBOOK_REPO = "Stockkart/engineering-handbook";
/** Same org as the webhook's S-4 rule (`GITHUB_ORG`); kept literal so `env.ts` needs no alias. */
export const HANDBOOK_REPO_OWNER = "Stockkart";

/** `Owner/repo` with the owner in the Stockkart org (case-insensitive, as GitHub compares). */
export function isHandbookRepo(value: string): boolean {
  const match =
    /^([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})\/((?!\.\.?$)[A-Za-z0-9._-]{1,100})$/.exec(
      value,
    );
  return match?.[1]?.toLowerCase() === HANDBOOK_REPO_OWNER.toLowerCase();
}

/**
 * Git's null object id. Stored in `docs.handbook_remote_sha` it means "absent on the default
 * branch" (removed in the handbook); `handbook_remote_sha IS NULL` with a `seen_at` means
 * "changed on the default branch, blob not known yet" (a push touched it). No real blob
 * hashes to all zeros, so the sentinel cannot collide.
 */
export const GIT_NULL_SHA = "0000000000000000000000000000000000000000";

/** The sync status of one doc (DOC-14), derived by `handbookSyncStatus`. */
export const HANDBOOK_SYNC_STATUSES = [
  "not_in_handbook",
  "in_sync",
  "changed_in_hq",
  "changed_in_handbook",
  "both_changed",
  "pr_open",
  "removed_in_handbook",
] as const;
export type HandbookSyncStatus = (typeof HANDBOOK_SYNC_STATUSES)[number];

export const HANDBOOK_SYNC_LABELS: Record<HandbookSyncStatus, string> = {
  not_in_handbook: "Not in handbook",
  in_sync: "In sync",
  changed_in_hq: "Changed in HQ",
  changed_in_handbook: "Changed in handbook",
  both_changed: "Both changed",
  pr_open: "PR open",
  removed_in_handbook: "Removed in handbook",
};

/** Publish at most this many docs in one PR (bulk "Publish selected"). */
export const HANDBOOK_PUBLISH_MAX = 50;

export const HANDBOOK_NOT_CONFIGURED_MESSAGE = "Handbook sync isn't set up";

/** Shown before every publish: the repo is public. */
export const HANDBOOK_PUBLIC_WARNING =
  "The handbook repo is PUBLIC: anything you publish is visible to everyone on the internet. Check for internal hosts, customer data, secrets and @mention names.";
