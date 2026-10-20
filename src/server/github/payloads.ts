import { z } from "zod";

import { isGithubUrl } from "@/lib/github/constants";

/**
 * Zod schemas for the webhook payloads (GH-1), with ONLY the fields HQ uses; anything else
 * GitHub sends is dropped. Every string is bounded, and URLs must point at github.com
 * because the Development panel renders them as links.
 */

/** Postgres `integer` upper bound. */
const MAX_INT = 2_147_483_647;
/** GitHub keeps at most 2048 commits in a push payload; HQ links the first 100 (GH-2). */
export const MAX_COMMITS_PER_PUSH = 100;

const login = z.string().min(1).max(100);
const githubUrl = z.string().max(2048).refine(isGithubUrl, "must be a https://github.com URL");
const branchName = z.string().min(1).max(255);

const repository = z.object({
  full_name: z.string().regex(/^[A-Za-z0-9-]{1,100}\/[A-Za-z0-9._-]{1,100}$/),
  owner: z.object({ login }),
  html_url: githubUrl,
  default_branch: branchName,
});

export type GithubRepository = z.infer<typeof repository>;

export const pullRequestPayload = z.object({
  action: z.string().min(1).max(50),
  pull_request: z.object({
    number: z.number().int().positive().max(MAX_INT),
    title: z.string().max(1024),
    // GitHub limits a PR body to 65,536 characters.
    body: z.string().max(70_000).nullish(),
    html_url: githubUrl,
    state: z.enum(["open", "closed"]),
    draft: z.boolean().optional(),
    merged: z.boolean().nullish(),
    merged_at: z.iso.datetime({ offset: true }).nullish(),
    user: z.object({ login }).nullish(),
    merged_by: z.object({ login }).nullish(),
    head: z.object({
      ref: branchName,
      repo: z.object({ full_name: z.string().max(201) }).nullish(),
    }),
    base: z.object({ ref: branchName }),
  }),
  repository,
});

const commit = z.object({
  // SHA-1 (40 hex) or SHA-256 (64 hex) object ids.
  id: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
  message: z.string().max(100_000),
  url: githubUrl,
  author: z.object({ username: login.optional() }).optional(),
});

export const pushPayload = z.object({
  ref: z.string().min(1).max(300),
  deleted: z.boolean().optional(),
  // Only the first commits are validated and used, so a huge push costs nothing extra.
  commits: z
    .array(z.unknown())
    .max(5000)
    .transform((commits) => commits.slice(0, MAX_COMMITS_PER_PUSH))
    .pipe(z.array(commit)),
  repository,
});

export const createPayload = z.object({
  ref: branchName,
  ref_type: z.string().max(20),
  repository,
});

export type PullRequestPayload = z.infer<typeof pullRequestPayload>;
export type PushPayload = z.infer<typeof pushPayload>;
export type CreatePayload = z.infer<typeof createPayload>;
