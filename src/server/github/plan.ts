import { GITHUB_ORG, type GithubPrState, type GithubRefKind } from "@/lib/github/constants";
import { extractIssueKeys, parseClosingKeys } from "@/lib/github/refs";
import { type IssueRef } from "@/lib/issues/keys";

import {
  type CreatePayload,
  type GithubRepository,
  type PullRequestPayload,
  type PushPayload,
} from "./payloads";

/**
 * Turns a validated webhook payload into what the database should do (GH-2, GH-3), without
 * touching the database. Pure, so every rule is unit-tested here; `applyDelivery` in
 * services/github.ts writes the plan in one statement.
 */

/** One `github_refs` row per issue key found. Keys of unknown issues are dropped in SQL. */
export interface PlannedRef {
  issue: IssueRef;
  kind: GithubRefKind;
  number: number | null;
  sha: string | null;
  refName: string | null;
  title: string;
  url: string;
  state: GithubPrState | null;
  authorLogin: string | null;
  /** ISO timestamp. */
  mergedAt: string | null;
}

export interface PlannedPullRequest {
  number: number;
  title: string;
  url: string;
  state: GithubPrState;
  authorLogin: string | null;
  mergedAt: string | null;
  headRef: string;
}

export interface DeliveryPlan {
  deliveryId: string;
  event: string;
  /** `Owner/repo`. */
  repo: string;
  refs: PlannedRef[];
  /** PR events: the PR's current state, applied to every row of it (linked earlier or now). */
  pullRequest: PlannedPullRequest | null;
  /** GH-3: merged into the default branch with closing keywords. */
  closes: { issues: IssueRef[]; pr: number; mergedBy: string | null } | null;
}

/** Bounds one delivery's writes, whatever the payload holds. */
const MAX_REFS_PER_DELIVERY = 500;
const MAX_TITLE_LENGTH = 300;

/** S-4: only repositories of the Stockkart organisation. */
export function isOrgRepository(repository: GithubRepository): boolean {
  const org = GITHUB_ORG.toLowerCase();
  const [owner] = repository.full_name.split("/");
  return repository.owner.login.toLowerCase() === org && owner?.toLowerCase() === org;
}

export function branchUrl(repository: GithubRepository, branch: string): string {
  return `${repository.html_url}/tree/${branch.split("/").map(encodeURIComponent).join("/")}`;
}

function firstLine(message: string): string {
  const line = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line.length > MAX_TITLE_LENGTH ? `${line.slice(0, MAX_TITLE_LENGTH - 1)}…` : line;
}

function refKey(ref: PlannedRef): string {
  return [ref.issue.projectKey, ref.issue.number, ref.kind, ref.number, ref.sha, ref.refName].join(
    "\u0000",
  );
}

/** Unique rows (one statement must not upsert the same row twice), capped. */
function uniqueRefs(refs: readonly PlannedRef[]): PlannedRef[] {
  const seen = new Set<string>();
  const result: PlannedRef[] = [];
  for (const ref of refs) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
    if (result.length >= MAX_REFS_PER_DELIVERY) break;
  }
  return result;
}

function branchRefs(repository: GithubRepository, branch: string): PlannedRef[] {
  return extractIssueKeys(branch).map((issue) => ({
    issue,
    kind: "branch",
    number: null,
    sha: null,
    refName: branch,
    title: branch,
    url: branchUrl(repository, branch),
    state: null,
    authorLogin: null,
    mergedAt: null,
  }));
}

interface Base {
  deliveryId: string;
  event: string;
}

/** `create` with `ref_type: branch`: link the new branch. */
export function planCreate(base: Base, payload: CreatePayload): DeliveryPlan {
  return {
    ...base,
    repo: payload.repository.full_name,
    refs: uniqueRefs(branchRefs(payload.repository, payload.ref)),
    pullRequest: null,
    closes: null,
  };
}

const BRANCH_REF_PREFIX = "refs/heads/";

/** `push`: link the branch and each commit (first 100) that mentions a key. */
export function planPush(base: Base, payload: PushPayload): DeliveryPlan {
  const refs: PlannedRef[] = [];
  // A deleted branch, or a tag, is not linked.
  if (payload.ref.startsWith(BRANCH_REF_PREFIX) && !payload.deleted) {
    refs.push(...branchRefs(payload.repository, payload.ref.slice(BRANCH_REF_PREFIX.length)));
  }
  for (const commit of payload.commits) {
    for (const issue of extractIssueKeys(commit.message)) {
      refs.push({
        issue,
        kind: "commit",
        number: null,
        sha: commit.id,
        refName: null,
        title: firstLine(commit.message),
        url: commit.url,
        state: null,
        authorLogin: commit.author?.username ?? null,
        mergedAt: null,
      });
    }
  }
  return {
    ...base,
    repo: payload.repository.full_name,
    refs: uniqueRefs(refs),
    pullRequest: null,
    closes: null,
  };
}

export function pullRequestState(pr: PullRequestPayload["pull_request"]): GithubPrState {
  if (pr.merged === true || (pr.state === "closed" && pr.merged_at)) return "merged";
  if (pr.state === "closed") return "closed";
  return pr.draft ? "draft" : "open";
}

/**
 * `pull_request` (any action): link the PR to every key in its head branch, title and body,
 * and update its state and title everywhere it is linked. A PR opening never changes an
 * issue's status; only a merge into the default branch with closing keywords does.
 */
export function planPullRequest(base: Base, payload: PullRequestPayload): DeliveryPlan {
  const pr = payload.pull_request;
  const repository = payload.repository;
  const state = pullRequestState(pr);
  const mergedAt = state === "merged" ? (pr.merged_at ?? null) : null;
  const title = pr.title.slice(0, MAX_TITLE_LENGTH);
  const authorLogin = pr.user?.login ?? null;
  const refs: PlannedRef[] = extractIssueKeys(pr.head.ref, pr.title, pr.body).map((issue) => ({
    issue,
    kind: "pr",
    number: pr.number,
    sha: null,
    refName: pr.head.ref,
    title,
    url: pr.html_url,
    state,
    authorLogin,
    mergedAt,
  }));
  // The head branch too, unless it lives in a fork (its link would point outside the org).
  if (pr.head.repo?.full_name.toLowerCase() === repository.full_name.toLowerCase()) {
    refs.push(...branchRefs(repository, pr.head.ref));
  }

  const mergedIntoDefault =
    payload.action === "closed" && state === "merged" && pr.base.ref === repository.default_branch;
  const closing = mergedIntoDefault ? parseClosingKeys(pr.title, pr.body) : [];

  return {
    ...base,
    repo: repository.full_name,
    refs: uniqueRefs(refs),
    pullRequest: {
      number: pr.number,
      title,
      url: pr.html_url,
      state,
      authorLogin,
      mergedAt,
      headRef: pr.head.ref,
    },
    closes:
      closing.length > 0
        ? { issues: closing, pr: pr.number, mergedBy: pr.merged_by?.login ?? null }
        : null,
  };
}
