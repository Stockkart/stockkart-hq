/**
 * GitHub integration vocabulary (SPEC §4.15, §8 `github_refs`). Isomorphic: shared by the
 * schema enums, the webhook and the Development panel.
 */

export const GITHUB_REF_KINDS = ["branch", "pr", "commit"] as const;
export type GithubRefKind = (typeof GITHUB_REF_KINDS)[number];

/** A PR's state as shown in HQ: `draft` is an open draft PR, `merged` a closed merged one. */
export const GITHUB_PR_STATES = ["open", "draft", "closed", "merged"] as const;
export type GithubPrState = (typeof GITHUB_PR_STATES)[number];

export const GITHUB_PR_STATE_LABELS: Record<GithubPrState, string> = {
  open: "Open",
  draft: "Draft",
  closed: "Closed",
  merged: "Merged",
};

/** S-4: only repositories of this GitHub organisation are linked (compared case-insensitively). */
export const GITHUB_ORG = "Stockkart";

/** Links to GitHub must stay on GitHub (they come from webhook payloads). */
export function isGithubUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com";
  } catch {
    return false;
  }
}
