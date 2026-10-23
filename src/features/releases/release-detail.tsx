"use client";

import { ArrowLeft, FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic } from "react";

import { IssueTypeIcon, StatusBadge } from "@/features/issue/issue-badges";
import {
  ISSUE_TYPE_LABELS,
  ISSUE_TYPES,
  STATUS_CATEGORIES,
  type StatusCategory,
} from "@/lib/issues/constants";
import { type ReleaseIssue, type ReleaseSummary } from "@/lib/releases/views";

import { ReleaseActions } from "./release-actions";
import { releaseDateLine, ReleaseProgress } from "./release-progress";
import { applyReleaseChange } from "./release-state";

const CATEGORY_TITLES: Record<StatusCategory, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

/**
 * REL-1 release page: progress (issues and points done), the issues grouped by status
 * category and counted by type, and the REL-2 notes doc. The actions are those of the list
 * (optimistic); a release deleted from here sends the user back to the list.
 */
export function ReleaseDetail({
  projectKey,
  releaseId,
  releases,
  issues,
}: {
  projectKey: string;
  releaseId: string;
  /** Every release of the project (the move-open-issues targets); includes this one. */
  releases: ReleaseSummary[];
  issues: ReleaseIssue[];
}) {
  const router = useRouter();
  const [shown, applyChange] = useOptimistic(releases, applyReleaseChange);
  const release = shown.find((item) => item.id === releaseId);
  const back = (
    <Link
      href={`/${projectKey}/releases`}
      className="inline-flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      Releases
    </Link>
  );
  if (!release) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          This release does not exist (any more).
        </p>
      </div>
    );
  }

  const byType = ISSUE_TYPES.map((type) => ({
    type,
    count: issues.filter((issue) => issue.type === type).length,
  })).filter((row) => row.count > 0);

  return (
    <div className="flex flex-col gap-6">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold">
            {release.name}
            <span className="ml-3 rounded-full border px-2 py-0.5 align-middle text-xs font-normal text-muted-foreground">
              {release.state === "released" ? "Released" : "Unreleased"}
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">{releaseDateLine(release)}</p>
          {release.description ? (
            <p className="max-w-prose text-sm whitespace-pre-line">{release.description}</p>
          ) : null}
        </div>
        <ReleaseActions
          projectKey={projectKey}
          release={release}
          releases={shown}
          onChange={applyChange}
          onDeleted={() => router.push(`/${projectKey}/releases`)}
        />
      </div>

      <section aria-labelledby="release-progress" className="flex flex-col gap-3">
        <h2 id="release-progress" className="text-lg font-medium">
          Progress
        </h2>
        <ReleaseProgress release={release} />
        {release.notesDocId ? (
          <Link
            href={`/${projectKey}/docs/${release.notesDocId}`}
            className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <FileText aria-hidden="true" className="size-4" />
            Release notes
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">
            No release notes yet: use “Generate release notes” in the menu.
          </p>
        )}
      </section>

      <section aria-labelledby="release-types" className="flex flex-col gap-3">
        <h2 id="release-types" className="text-lg font-medium">
          By type
        </h2>
        {byType.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {byType.map((row) => (
              <li
                key={row.type}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm"
              >
                <IssueTypeIcon type={row.type} />
                {ISSUE_TYPE_LABELS[row.type]}
                <span className="text-muted-foreground tabular-nums">{row.count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No issues have this fix version yet. Set it in an issue&apos;s side panel, in quick
            create or with the bulk bar of the issue list.
          </p>
        )}
      </section>

      {STATUS_CATEGORIES.map((category) => {
        const items = issues.filter((issue) => issue.status.category === category);
        const id = `release-${category}`;
        return (
          <section key={category} aria-labelledby={id} className="flex flex-col gap-2">
            <h2 id={id} className="text-lg font-medium">
              {CATEGORY_TITLES[category]}{" "}
              <span className="text-sm font-normal text-muted-foreground tabular-nums">
                {items.length}
              </span>
            </h2>
            {items.length > 0 ? (
              <ul className="divide-y rounded-lg border">
                {items.map((issue) => (
                  <li key={issue.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <IssueTypeIcon type={issue.type} />
                    <Link
                      href={`/${projectKey}/issues/${issue.key}`}
                      className="min-w-0 flex-1 truncate rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <span className="mr-2 font-mono text-xs text-muted-foreground">
                        {issue.key}
                      </span>
                      {issue.title}
                    </Link>
                    <StatusBadge name={issue.status.name} category={issue.status.category} />
                    <span className="w-12 text-right text-muted-foreground tabular-nums">
                      {issue.storyPoints ?? "–"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">None.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
