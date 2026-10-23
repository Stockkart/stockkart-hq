import { z } from "zod";

import { isHandbookPath } from "@/lib/docs/handbook-path";
import { pullRequestPayload, type GithubRepository } from "@/server/github/payloads";

import { isHqBranch } from "./github-app";

/**
 * DOC-14 repo → HQ detection from the org webhook, for the handbook repo only. Pure: turns
 * an already signature-checked, deduplicated delivery into DB updates that
 * `applyDelivery` (services/github.ts) writes in its one statement. It never calls GitHub:
 * the webhook must answer fast, and the blob shas are fetched later, on demand.
 *
 *   pull_request closed, head `hq/…` in the handbook repo itself (not a fork):
 *     merged into the default branch → that publication `merged`, its docs synced
 *     otherwise                      → `closed` (no doc changes)
 *   push to the default branch: the commits' added / modified / removed `.md` paths (last
 *     change wins, at most 500): matching docs get `handbook_remote_seen_at = now()` and
 *     `handbook_remote_sha` NULL ("changed, blob unknown") or `GIT_NULL_SHA` (removed).
 *     A path whose every commit names an `hq/…` branch (HQ's `HQ-Publication:` trailer, a
 *     merge commit "Merge pull request #n from Stockkart/hq/…", or a squash that keeps the
 *     message) is HQ's own publication landing: SQL skips it for docs of that publication,
 *     which the pull_request event syncs instead. A commit can claim that name in its message
 *     only to hide drift on a doc already in that PR; "Check handbook now" compares real
 *     blobs and catches it.
 */

export const MAX_HANDBOOK_PATHS = 500;

export interface HandbookPathChange {
  path: string;
  removed: boolean;
  /** `hq/…` branches named by EVERY commit that touched the path; empty = a person's change. */
  branches: string[];
}

export interface HandbookDeliveryPlan {
  pullRequest: {
    number: number;
    branch: string;
    /** The PR's page (stored on the publication if HQ never recorded it). */
    url: string;
    outcome: "merged" | "closed";
    /** ISO; set for `merged`. */
    mergedAt: string | null;
    /**
     * HQ's PR has exactly one commit. More means someone pushed to the `hq/…` branch, so the
     * merged files may not be the blobs HQ recorded: the docs are marked synced to HQ's
     * export, but the handbook side as "changed, blob unknown".
     */
    cleanMerge: boolean;
  } | null;
  paths: HandbookPathChange[];
  /** More than `MAX_HANDBOOK_PATHS` paths: the rest wait for "Check handbook now". */
  truncated: boolean;
}

const pathList = z.array(z.string().max(1000)).max(10_000).optional();
const handbookPush = z.object({
  ref: z.string().min(1).max(300),
  deleted: z.boolean().optional(),
  commits: z
    .array(
      z.object({
        message: z.string().max(100_000),
        added: pathList,
        modified: pathList,
        removed: pathList,
      }),
    )
    .max(5000),
});

export function isHandbookRepository(repository: GithubRepository, handbookRepo: string): boolean {
  return repository.full_name.toLowerCase() === handbookRepo.toLowerCase();
}

/**
 * `hq/…` branches a commit message names as HQ's own: the `HQ-Publication: <branch>` trailer
 * line HQ writes (kept by squash and rebase merges, optionally as a squash's `* ` list item),
 * or GitHub's merge-commit subject "Merge pull request #n from <owner>/<branch>". A mention
 * anywhere else does not count, and neither does a revert ("Revert "Merge pull request …"").
 */
export function hqBranchesIn(message: string): string[] {
  if (/^\s*revert\b/i.test(message)) return [];
  const found = new Set<string>();
  const add = (name: string | undefined) => {
    if (name && isHqBranch(name)) found.add(name);
  };
  for (const [, name] of message.matchAll(
    /^[ \t]*(?:\* )?HQ-Publication: (hq\/\S{1,100})[ \t]*$/gm,
  )) {
    add(name);
  }
  const subject = message.split("\n", 1)[0] ?? "";
  add(/^Merge pull request #\d+ from [A-Za-z0-9-]+\/(hq\/\S{1,100})$/.exec(subject)?.[1]);
  return [...found];
}

export function planHandbookPush(
  payload: unknown,
  repository: GithubRepository,
): HandbookDeliveryPlan | null {
  const parsed = handbookPush.safeParse(payload);
  if (!parsed.success) return null;
  const push = parsed.data;
  if (push.deleted || push.ref !== `refs/heads/${repository.default_branch}`) return null;

  const changes = new Map<
    string,
    { path: string; removed: boolean; foreign: boolean; branches: Set<string> }
  >();
  let truncated = false;
  for (const commit of push.commits) {
    const branches = hqBranchesIn(commit.message);
    const touch = (path: string, removed: boolean) => {
      if (!isHandbookPath(path)) return;
      const key = path.toLowerCase();
      let change = changes.get(key);
      if (!change) {
        if (changes.size >= MAX_HANDBOOK_PATHS) {
          truncated = true;
          return;
        }
        change = { path, removed, foreign: false, branches: new Set() };
        changes.set(key, change);
      }
      // Commits arrive oldest first: the last change wins.
      change.path = path;
      change.removed = removed;
      if (branches.length === 0) change.foreign = true;
      for (const branch of branches) change.branches.add(branch);
    };
    for (const path of commit.added ?? []) touch(path, false);
    for (const path of commit.modified ?? []) touch(path, false);
    for (const path of commit.removed ?? []) touch(path, true);
  }
  if (changes.size === 0) return null;
  return {
    pullRequest: null,
    paths: [...changes.values()].map((change) => ({
      path: change.path,
      removed: change.removed,
      branches: change.foreign ? [] : [...change.branches].sort(),
    })),
    truncated,
  };
}

export function planHandbookPullRequest(payload: unknown): HandbookDeliveryPlan | null {
  const parsed = pullRequestPayload.safeParse(payload);
  if (!parsed.success) return null;
  const { action, pull_request: pr, repository } = parsed.data;
  if (action !== "closed" || pr.state !== "closed") return null;
  if (!isHqBranch(pr.head.ref)) return null;
  // A fork can name its branch `hq/…` too: only branches of the handbook repo itself.
  if (pr.head.repo?.full_name.toLowerCase() !== repository.full_name.toLowerCase()) return null;
  const merged = pr.merged === true && pr.base.ref === repository.default_branch;
  const commits = prCommits.safeParse(payload);
  return {
    pullRequest: {
      number: pr.number,
      branch: pr.head.ref,
      url: pr.html_url,
      outcome: merged ? "merged" : "closed",
      mergedAt: merged ? (pr.merged_at ?? pr.updated_at ?? null) : null,
      cleanMerge: commits.success && commits.data.pull_request.commits === 1,
    },
    paths: [],
    truncated: false,
  };
}

const prCommits = z.object({
  pull_request: z.object({ commits: z.number().int().nonnegative() }),
});

/** The handbook part of a delivery, or null when it changes nothing. */
export function planHandbookDelivery(
  event: string,
  payload: unknown,
  repository: GithubRepository,
): HandbookDeliveryPlan | null {
  if (event === "push") return planHandbookPush(payload, repository);
  if (event === "pull_request") return planHandbookPullRequest(payload);
  return null;
}
