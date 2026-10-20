import { desc, eq, sql } from "drizzle-orm";

import { isGithubUrl } from "@/lib/github/constants";
import {
  type BranchView,
  type CommitView,
  type DevelopmentView,
  type GithubAuthor,
  type PullRequestView,
} from "@/lib/github/views";
import { directRead } from "@/server/db/read-batch";
import { githubRefs, users } from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

import { type QueryOptions } from "./issue-queries";
import { type IdRef } from "./sql";

/** Bounds the panel; an issue with more links than this shows the newest. */
const DEVELOPMENT_LIMIT = 300;

/**
 * GH-4 read side: an issue's branches, PRs and commits in ONE statement (the issue may be an
 * `IdRef` subquery, so the issue page loads it in its single batched round trip). Authors
 * are mapped to HQ users whose `github_login` matches, case-insensitively (the join uses the
 * `lower(github_login)` unique index).
 */
export function createGithubQueries(db: AppDatabase, { read = directRead }: QueryOptions = {}) {
  return {
    async listDevelopment(issueId: IdRef): Promise<DevelopmentView> {
      const rows = await read(
        db
          .select({
            id: githubRefs.id,
            repo: githubRefs.repo,
            kind: githubRefs.kind,
            number: githubRefs.number,
            sha: githubRefs.sha,
            refName: githubRefs.refName,
            title: githubRefs.title,
            url: githubRefs.url,
            state: githubRefs.state,
            authorLogin: githubRefs.authorLogin,
            mergedAt: githubRefs.mergedAt,
            createdAt: githubRefs.createdAt,
            userId: users.id,
            userName: users.name,
          })
          .from(githubRefs)
          .leftJoin(users, sql`lower(${users.githubLogin}) = lower(${githubRefs.authorLogin})`)
          .where(eq(githubRefs.issueId, issueId))
          .orderBy(desc(githubRefs.createdAt), desc(githubRefs.id))
          .limit(DEVELOPMENT_LIMIT),
      );

      const view: DevelopmentView = { branches: [], pullRequests: [], commits: [] };
      for (const row of rows) {
        // Stored URLs came from verified payloads; re-checked so a link never leaves GitHub.
        if (!isGithubUrl(row.url)) continue;
        const author: GithubAuthor | null = row.authorLogin
          ? {
              login: row.authorLogin,
              user: row.userId && row.userName ? { id: row.userId, name: row.userName } : null,
            }
          : null;
        if (row.kind === "branch" && row.refName) {
          const branch: BranchView = {
            id: row.id,
            repo: row.repo,
            name: row.refName,
            url: row.url,
          };
          view.branches.push(branch);
        } else if (row.kind === "pr" && row.number !== null && row.state) {
          const pr: PullRequestView = {
            id: row.id,
            repo: row.repo,
            number: row.number,
            title: row.title,
            url: row.url,
            state: row.state,
            author,
            mergedAt: row.mergedAt,
          };
          view.pullRequests.push(pr);
        } else if (row.kind === "commit" && row.sha) {
          const commit: CommitView = {
            id: row.id,
            repo: row.repo,
            sha: row.sha,
            message: row.title,
            url: row.url,
            author,
            createdAt: row.createdAt,
          };
          view.commits.push(commit);
        }
      }
      return view;
    },
  };
}

export type GithubQueries = ReturnType<typeof createGithubQueries>;
