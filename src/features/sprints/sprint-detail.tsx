"use client";

import Link from "next/link";
import { useOptimistic } from "react";

import { IssueTypeIcon, StatusBadge } from "@/features/issue/issue-badges";
import { type PlanningIssue } from "@/lib/issues/views";
import { formatDateRange } from "@/lib/sprints/dates";
import { type Burndown, type SprintSummary } from "@/lib/sprints/views";

import { SprintActions, type SprintContext } from "./sprint-actions";
import { BurndownPanel } from "./sprint-charts";
import { applySprintChange } from "./sprint-state";

const STATE_LABELS = { planned: "Planned", active: "Active", closed: "Closed" } as const;

/** One sprint (SPR-3): its facts, actions, burndown (once started) and issues. */
export function SprintDetail({
  projectKey,
  sprintLengthDays,
  sprintId,
  sprints,
  burndown,
  issues,
}: {
  projectKey: string;
  sprintLengthDays: number;
  sprintId: string;
  sprints: SprintSummary[];
  burndown: Burndown | null;
  issues: PlanningIssue[];
}) {
  const [shown, applyChange] = useOptimistic(sprints, applySprintChange);
  const sprint = shown.find((item) => item.id === sprintId);
  const context: SprintContext = {
    projectKey,
    sprintLengthDays,
    sprints: shown,
    newSprintName: `Sprint ${shown.length + 1}`,
  };

  if (!sprint) {
    return (
      <p className="text-sm text-muted-foreground">
        This sprint was deleted.{" "}
        <Link href={`/${projectKey}/sprints`} className="underline underline-offset-2">
          All sprints
        </Link>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            <Link href={`/${projectKey}/sprints`} className="hover:underline">
              Sprints
            </Link>{" "}
            / {STATE_LABELS[sprint.state]}
          </p>
          <h1 className="text-2xl font-semibold">{sprint.name}</h1>
          <p className="text-sm text-muted-foreground">
            {formatDateRange(sprint.startDate, sprint.endDate)}
            {sprint.goal ? ` · ${sprint.goal}` : null}
          </p>
        </div>
        <SprintActions sprint={sprint} context={context} onChange={applyChange} />
      </div>

      {burndown ? (
        <BurndownPanel burndown={burndown} />
      ) : (
        <p className="text-sm text-muted-foreground">
          The burndown appears once the sprint has started.
        </p>
      )}

      <section aria-labelledby="sprint-issues" className="flex flex-col gap-2">
        <h2 id="sprint-issues" className="text-lg font-medium">
          Issues{" "}
          <span className="text-sm font-normal text-muted-foreground">({issues.length})</span>
        </h2>
        {issues.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {issues.map((issue) => (
              <li key={issue.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <IssueTypeIcon type={issue.type} />
                <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                  {issue.key}
                </span>
                <Link
                  href={`/${projectKey}/issues/${issue.key}`}
                  className="min-w-0 flex-1 truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="sr-only">{issue.key}: </span>
                  {issue.title}
                </Link>
                <StatusBadge name={issue.status.name} category={issue.status.category} />
                <span className="w-12 text-right text-muted-foreground tabular-nums">
                  {issue.storyPoints ?? "–"}
                  <span className="sr-only"> points</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No issues. Add some from the{" "}
            <Link href={`/${projectKey}/backlog`} className="underline underline-offset-2">
              backlog
            </Link>
            .
          </p>
        )}
      </section>
    </div>
  );
}
