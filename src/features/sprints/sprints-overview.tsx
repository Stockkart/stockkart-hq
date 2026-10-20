"use client";

import Link from "next/link";
import { useOptimistic } from "react";

import { VELOCITY_SPRINTS } from "@/lib/sprints/constants";
import { formatDateRange } from "@/lib/sprints/dates";
import { type Burndown, type SprintSummary, type VelocityBar } from "@/lib/sprints/views";

import { CreateSprintButton, SprintActions, type SprintContext } from "./sprint-actions";
import { BurndownPanel, VelocityPanel } from "./sprint-charts";
import { applySprintChange } from "./sprint-state";

interface SprintsOverviewProps {
  projectKey: string;
  sprintLengthDays: number;
  sprints: SprintSummary[];
  /** SPR-1 create-dialog defaults, worked out on the server. */
  defaults: { name: string; startDate: string; endDate: string };
  activeBurndown: Burndown | null;
  velocity: VelocityBar[];
}

const pts = (value: number) => `${value} ${value === 1 ? "pt" : "pts"}`;

/**
 * SPR-1…4 sprint list: the active sprint (with its burndown), planned sprints by start date,
 * then the last closed ones with the velocity chart. Every change is optimistic (see
 * `SprintChange`).
 */
export function SprintsOverview({
  projectKey,
  sprintLengthDays,
  sprints,
  defaults,
  activeBurndown,
  velocity,
}: SprintsOverviewProps) {
  const [shown, applyChange] = useOptimistic(sprints, applySprintChange);
  const context: SprintContext = {
    projectKey,
    sprintLengthDays,
    sprints: shown,
    newSprintName: `Sprint ${shown.length + 1}`,
  };
  const active = shown.find((sprint) => sprint.state === "active");
  const planned = shown.filter((sprint) => sprint.state === "planned");
  const closed = shown.filter((sprint) => sprint.state === "closed").slice(0, VELOCITY_SPRINTS);
  const completedBy = new Map(velocity.map((bar) => [bar.sprintId, bar.completed]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Sprints</h1>
        <CreateSprintButton context={context} defaults={defaults} onChange={applyChange} />
      </div>

      <section aria-labelledby="sprints-active" className="flex flex-col gap-3">
        <h2 id="sprints-active" className="text-lg font-medium">
          Active
        </h2>
        {active ? (
          <SprintCard projectKey={projectKey} sprint={active}>
            <SprintActions sprint={active} context={context} onChange={applyChange} />
          </SprintCard>
        ) : (
          <p className="text-sm text-muted-foreground">
            No sprint is active. Start a planned one below.
          </p>
        )}
        {active && activeBurndown && active.id === sprints.find((s) => s.state === "active")?.id ? (
          <BurndownPanel burndown={activeBurndown} title={`${active.name} burndown`} />
        ) : null}
      </section>

      <section aria-labelledby="sprints-planned" className="flex flex-col gap-3">
        <h2 id="sprints-planned" className="text-lg font-medium">
          Planned
        </h2>
        {planned.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {planned.map((sprint) => (
              <li key={sprint.id}>
                <SprintCard projectKey={projectKey} sprint={sprint}>
                  <SprintActions sprint={sprint} context={context} onChange={applyChange} />
                </SprintCard>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No planned sprints. Create one, then add issues from the{" "}
            <Link href={`/${projectKey}/backlog`} className="underline underline-offset-2">
              backlog
            </Link>
            .
          </p>
        )}
      </section>

      <section aria-labelledby="sprints-closed" className="flex flex-col gap-3">
        <h2 id="sprints-closed" className="text-lg font-medium">
          Recently closed
        </h2>
        {closed.length > 0 ? (
          <>
            <VelocityPanel bars={velocity} />
            <ul className="flex flex-col gap-2">
              {closed.map((sprint) => (
                <li key={sprint.id}>
                  <SprintCard projectKey={projectKey} sprint={sprint}>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {pts(completedBy.get(sprint.id) ?? sprint.done.points)} completed
                    </span>
                  </SprintCard>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No closed sprints yet.</p>
        )}
      </section>
    </div>
  );
}

function SprintCard({
  projectKey,
  sprint,
  children,
}: {
  projectKey: string;
  sprint: SprintSummary;
  children?: React.ReactNode;
}) {
  const total = sprint.open.points + sprint.done.points;
  const pending = sprint.id.startsWith("new:");
  return (
    <article
      aria-label={sprint.name}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-4 py-3"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 className="font-medium">
          {pending ? (
            sprint.name
          ) : (
            <Link
              href={`/${projectKey}/sprints/${sprint.id}`}
              className="rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {sprint.name}
            </Link>
          )}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {formatDateRange(sprint.startDate, sprint.endDate)}
          </span>
        </h3>
        {sprint.goal ? <p className="text-sm text-muted-foreground">{sprint.goal}</p> : null}
      </div>
      <p className="text-sm text-muted-foreground tabular-nums">
        {sprint.state === "planned"
          ? `${sprint.open.count} ${sprint.open.count === 1 ? "issue" : "issues"} · ${pts(sprint.open.points)}`
          : `${sprint.done.points} of ${pts(total)} done`}
      </p>
      {children}
    </article>
  );
}
