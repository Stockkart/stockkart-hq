import { type GithubPrState } from "./constants";

/** GH-4 Development panel read models (plain data, server → client). */

/** An HQ user whose `github_login` matches the GitHub author. */
export interface GithubAuthor {
  login: string;
  user: { id: string; name: string } | null;
}

export interface BranchView {
  id: string;
  repo: string;
  name: string;
  url: string;
}

export interface PullRequestView {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  state: GithubPrState;
  author: GithubAuthor | null;
  mergedAt: Date | null;
}

export interface CommitView {
  id: string;
  repo: string;
  sha: string;
  /** The message's first line. */
  message: string;
  url: string;
  author: GithubAuthor | null;
  createdAt: Date;
}

export interface DevelopmentView {
  branches: BranchView[];
  pullRequests: PullRequestView[];
  /** Newest first. */
  commits: CommitView[];
}
