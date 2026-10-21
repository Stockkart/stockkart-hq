"use client";

import { GitBranch, GitCommitHorizontal, GitPullRequest } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { GITHUB_PR_STATE_LABELS, type GithubPrState, isGithubUrl } from "@/lib/github/constants";
import { type DevelopmentView, type GithubAuthor } from "@/lib/github/views";
import { cn } from "@/lib/utils";

import { Avatar } from "./issue-badges";

/** Commits shown before "Show all". */
export const COMMITS_SHOWN = 5;

const PR_STATE_STYLES: Record<GithubPrState, string> = {
  open: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  draft: "border-muted-foreground/40 text-muted-foreground",
  merged: "border-violet-600/40 text-violet-700 dark:text-violet-400",
  closed: "border-red-600/40 text-red-700 dark:text-red-400",
};

/** A link to GitHub, in a new tab, without giving GitHub a handle on this window. */
function GithubLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  // URLs come from verified webhooks and are re-checked on read; never link elsewhere.
  if (!isGithubUrl(href)) return <span className={className}>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("hover:underline focus-visible:underline", className)}
    >
      {children}
      <span className="sr-only"> (opens GitHub in a new tab)</span>
    </a>
  );
}

/** The HQ user when their GitHub username matches, else the GitHub login. */
function Author({ author }: { author: GithubAuthor | null }) {
  if (!author) return null;
  const name = author.user?.name ?? author.login;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      title={author.login}
    >
      <Avatar name={name} className="size-4 text-[8px]" />
      {name}
    </span>
  );
}

function Section({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: typeof GitBranch;
  count: number;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <h3
        id={headingId}
        className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
      >
        <Icon aria-hidden="true" className="size-3.5" />
        {title} ({count})
      </h3>
      {children}
    </section>
  );
}

/** GH-4: branches, pull requests and commits that mention this issue. */
export function DevelopmentPanel({ development }: { development: DevelopmentView }) {
  const [showAllCommits, setShowAllCommits] = useState(false);
  const headingId = useId();
  const { branches, pullRequests, commits } = development;
  const empty = branches.length === 0 && pullRequests.length === 0 && commits.length === 0;
  const visibleCommits = showAllCommits ? commits : commits.slice(0, COMMITS_SHOWN);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 text-sm">
      <h2 id={headingId} className="text-sm font-semibold">
        Development
      </h2>
      {empty ? (
        <p className="text-xs text-muted-foreground">
          Nothing linked yet. Mention the key in a branch name, PR or commit.
        </p>
      ) : null}

      {branches.length > 0 ? (
        <Section title="Branches" icon={GitBranch} count={branches.length}>
          <ul className="flex flex-col gap-1">
            {branches.map((branch) => (
              <li key={branch.id} className="flex min-w-0 flex-col">
                <GithubLink href={branch.url} className="truncate font-mono text-xs">
                  {branch.name}
                </GithubLink>
                <span className="truncate text-xs text-muted-foreground">{branch.repo}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {pullRequests.length > 0 ? (
        <Section title="Pull requests" icon={GitPullRequest} count={pullRequests.length}>
          <ul className="flex flex-col gap-2">
            {pullRequests.map((pr) => (
              <li key={pr.id} className="flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <GithubLink href={pr.url} className="min-w-0 truncate">
                    <span className="text-muted-foreground">#{pr.number}</span> {pr.title}
                  </GithubLink>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-px text-[11px] font-medium",
                      PR_STATE_STYLES[pr.state],
                    )}
                  >
                    {GITHUB_PR_STATE_LABELS[pr.state]}
                  </span>
                  <Author author={pr.author} />
                  <span className="truncate text-xs text-muted-foreground">{pr.repo}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {commits.length > 0 ? (
        <Section title="Commits" icon={GitCommitHorizontal} count={commits.length}>
          <ul className="flex flex-col gap-1.5">
            {visibleCommits.map((commit) => (
              <li key={commit.id} className="flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 items-baseline gap-1.5">
                  <GithubLink href={commit.url} className="shrink-0 font-mono text-xs">
                    {commit.sha.slice(0, 7)}
                  </GithubLink>
                  <span className="truncate text-xs" title={commit.message}>
                    {commit.message}
                  </span>
                </div>
                <Author author={commit.author} />
              </li>
            ))}
          </ul>
          {commits.length > COMMITS_SHOWN ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 self-start px-2 text-xs"
              aria-expanded={showAllCommits}
              onClick={() => setShowAllCommits((value) => !value)}
            >
              {showAllCommits ? "Show fewer" : `Show all ${commits.length} commits`}
            </Button>
          ) : null}
        </Section>
      ) : null}
    </section>
  );
}
