"use client";

import { AlertTriangle, CalendarPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { callAction } from "@/features/issue/client-utils";
import { Avatar, StatusBadge } from "@/features/issue/issue-badges";
import { type NamedOption } from "@/lib/issues/views";
import { DAY_WIDTH, ROW_HEIGHT, type RoadmapZoom } from "@/lib/roadmap/constants";
import { type ResolvedDependency, resolveDependencies } from "@/lib/roadmap/dependencies";
import { type RoadmapFilters } from "@/lib/roadmap/filters";
import { epicProgress } from "@/lib/roadmap/progress";
import { timelineTicks, timelineWindow } from "@/lib/roadmap/timeline";
import { type DateRange, type RoadmapDependency, type RoadmapEpic } from "@/lib/roadmap/views";
import { daysBetween, formatDateRange, formatShortDate } from "@/lib/sprints/dates";
import { cn } from "@/lib/utils";
import { updateIssueFieldAction } from "@/server/actions/issues";

import { DateDialog, type Schedule } from "./date-dialog";
import { EpicBar } from "./epic-bar";
import { RoadmapToolbar } from "./roadmap-toolbar";

/** Width of the sticky epic column; the timeline starts after it. */
const LABEL_WIDTH = 240;
const HEADER_HEIGHT = 32;

/**
 * The bar of an epic with both dates in order. An epic missing one (or, from before the
 * due-date check, due before it starts) is listed under Unscheduled to be fixed there.
 */
const scheduled = (epic: RoadmapEpic): DateRange | null =>
  epic.startDate && epic.dueDate && epic.startDate <= epic.dueDate
    ? { start: epic.startDate, end: epic.dueDate }
    : null;

/**
 * RDM-1/RDM-2 roadmap: one row per epic with a bar from its start to its due date on a
 * week / month / quarter timeline, its child progress, a today line and arrows for
 * `blocks` dependencies (conflicts highlighted); epics missing a date are listed under
 * "Unscheduled". Dates save through `updateIssueField` (`schedule`, with activity rows),
 * optimistically, rolled back by React when the save fails. Drawn with plain HTML/SVG.
 */
export function Roadmap({
  projectKey,
  epics,
  dependencies,
  zoom,
  filters,
  components,
  users,
  today,
}: {
  projectKey: string;
  epics: RoadmapEpic[];
  dependencies: RoadmapDependency[];
  zoom: RoadmapZoom;
  filters: RoadmapFilters;
  components: NamedOption[];
  users: NamedOption[];
  /** ISO date, from the server, so both renders agree. */
  today: string;
}) {
  const [shown, applySchedule] = useOptimistic(epics, (state, change: { id: string } & Schedule) =>
    state.map((epic) =>
      epic.id === change.id
        ? { ...epic, startDate: change.startDate, dueDate: change.dueDate }
        : epic,
    ),
  );
  const [, startTransition] = useTransition();
  const [announcement, setAnnouncement] = useState("");
  const [editing, setEditing] = useState<RoadmapEpic | null>(null);
  const instructionsId = useId();

  function save(epic: RoadmapEpic, next: Schedule) {
    if (next.startDate === epic.startDate && next.dueDate === epic.dueDate) return;
    startTransition(async () => {
      applySchedule({ id: epic.id, ...next });
      const result = await callAction(() =>
        updateIssueFieldAction({ issueId: epic.id, field: "schedule", value: next }),
      );
      setAnnouncement(
        result
          ? next.startDate && next.dueDate
            ? `${epic.key} now runs ${formatDateRange(next.startDate, next.dueDate)}`
            : `${epic.key} moved to Unscheduled`
          : `Could not save the dates of ${epic.key}`,
      );
    });
  }

  const onTimeline = shown.filter((epic) => scheduled(epic) !== null);
  const unscheduled = shown.filter((epic) => scheduled(epic) === null);
  const resolved = resolveDependencies(dependencies, shown);
  const conflicted = new Set(
    resolved.filter((d) => d.conflict).flatMap((d) => [d.blocker.id, d.blocked.id]),
  );
  // The epic being edited, with its dates as shown now (a nudge may have just been saved).
  const editingNow = editing ? (shown.find((e) => e.id === editing.id) ?? editing) : null;

  return (
    <div className="flex flex-col gap-6">
      <RoadmapToolbar zoom={zoom} filters={filters} components={components} users={users} />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <p id={instructionsId} className="sr-only">
        Arrow keys move the bar by a day, Shift+arrow by a week; Alt+arrow changes the end date.
        Enter edits the dates. Changes are saved when you stop.
      </p>

      {onTimeline.length > 0 ? (
        <Timeline
          projectKey={projectKey}
          epics={onTimeline}
          dependencies={resolved}
          conflicted={conflicted}
          zoom={zoom}
          today={today}
          describedBy={instructionsId}
          onCommit={(epic, range) => save(epic, { startDate: range.start, dueDate: range.end })}
          onEdit={setEditing}
        />
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {shown.length === 0
            ? "No epics match. Create an epic, or clear the filters."
            : "No epic has both a start and a due date yet. Set them below."}
        </p>
      )}

      <Unscheduled projectKey={projectKey} epics={unscheduled} onEdit={setEditing} />
      <Dependencies projectKey={projectKey} dependencies={resolved} />

      {editingNow ? (
        <DateDialog
          // Re-seeds the fields when the shown dates change (e.g. a nudge saved on Enter).
          key={`${editingNow.startDate ?? ""}/${editingNow.dueDate ?? ""}`}
          epicKey={editingNow.key}
          title={editingNow.title}
          schedule={{ startDate: editingNow.startDate, dueDate: editingNow.dueDate }}
          onSave={(next) => save(editingNow, next)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function Timeline({
  projectKey,
  epics,
  dependencies,
  conflicted,
  zoom,
  today,
  describedBy,
  onCommit,
  onEdit,
}: {
  projectKey: string;
  epics: RoadmapEpic[];
  dependencies: ResolvedDependency[];
  conflicted: Set<string>;
  zoom: RoadmapZoom;
  today: string;
  describedBy: string;
  onCommit: (epic: RoadmapEpic, range: DateRange) => void;
  onEdit: (epic: RoadmapEpic) => void;
}) {
  const dayWidth = DAY_WIDTH[zoom];
  const ranges = epics.flatMap((epic) => scheduled(epic) ?? []);
  const frame = timelineWindow(ranges, today, zoom);
  const ticks = timelineTicks(frame, zoom);
  const width = frame.days * dayWidth;
  const height = epics.length * ROW_HEIGHT;
  const todayX = daysBetween(frame.start, today) * dayWidth;
  const scroller = useRef<HTMLDivElement>(null);
  const rowOf = new Map(epics.map((epic, index) => [epic.id, index]));

  // Open on today (once per zoom), with some context before it.
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollLeft = Math.max(0, todayX - node.clientWidth / 3);
  }, [zoom, todayX]);

  const x = (date: string) => daysBetween(frame.start, date) * dayWidth;

  return (
    <section aria-label="Timeline" className="rounded-lg border">
      <div ref={scroller} className="overflow-x-auto">
        <div className="relative" style={{ width: LABEL_WIDTH + width }}>
          {/* Header: the epic column and the ticks. */}
          <div className="flex border-b" style={{ height: HEADER_HEIGHT }}>
            <div
              className="sticky left-0 z-20 flex shrink-0 items-center border-r bg-background px-3 text-xs font-medium text-muted-foreground"
              style={{ width: LABEL_WIDTH }}
            >
              Epic
            </div>
            <div aria-hidden="true" className="relative shrink-0" style={{ width }}>
              {ticks.map((tick) => (
                <span
                  key={tick.date}
                  className="absolute top-0 flex h-full items-center border-l pl-1.5 text-xs whitespace-nowrap text-muted-foreground"
                  style={{ left: tick.offset * dayWidth }}
                >
                  {tick.label}
                </span>
              ))}
              <span
                className="absolute top-0 z-10 -translate-x-1/2 rounded-b bg-red-600 px-1 text-[10px] font-medium text-white"
                style={{ left: todayX }}
              >
                Today
              </span>
            </div>
          </div>

          {/* Grid lines, the today line and the dependency arrows, under the rows. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute"
            style={{ left: LABEL_WIDTH, top: HEADER_HEIGHT, width, height }}
          >
            {ticks.map((tick) => (
              <span
                key={tick.date}
                className="absolute inset-y-0 border-l border-border/60"
                style={{ left: tick.offset * dayWidth }}
              />
            ))}
            <span
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-red-600 dark:bg-red-500"
              style={{ left: todayX }}
            />
            <svg width={width} height={height} className="absolute inset-0 overflow-visible">
              <defs>
                <marker
                  id="rdm-arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L8,4 L0,8 z" className="fill-muted-foreground" />
                </marker>
                <marker
                  id="rdm-arrow-conflict"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L8,4 L0,8 z" className="fill-destructive" />
                </marker>
              </defs>
              {dependencies.map((dependency) => {
                const from = rowOf.get(dependency.blocker.id);
                const to = rowOf.get(dependency.blocked.id);
                const { dueDate } = dependency.blocker;
                const { startDate } = dependency.blocked;
                if (from === undefined || to === undefined || !dueDate || !startDate) return null;
                const x1 = x(dueDate) + dayWidth;
                const y1 = from * ROW_HEIGHT + ROW_HEIGHT / 2;
                const x2 = x(startDate);
                const y2 = to * ROW_HEIGHT + ROW_HEIGHT / 2;
                const bend = Math.max(16, Math.abs(x2 - x1) / 2);
                return (
                  <path
                    key={dependency.linkId}
                    d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    strokeWidth={dependency.conflict ? 2 : 1.5}
                    strokeDasharray={dependency.conflict ? "4 3" : undefined}
                    className={
                      dependency.conflict ? "stroke-destructive" : "stroke-muted-foreground"
                    }
                    markerEnd={`url(#${dependency.conflict ? "rdm-arrow-conflict" : "rdm-arrow"})`}
                  />
                );
              })}
            </svg>
          </div>

          <ul aria-label="Epics on the timeline" className="relative">
            {epics.map((epic) => {
              const range = scheduled(epic);
              if (!range) return null;
              const progress = epicProgress(epic.children);
              return (
                <li
                  key={epic.id}
                  className="flex border-b last:border-b-0"
                  style={{ height: ROW_HEIGHT }}
                >
                  <div
                    className="sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-0.5 border-r bg-background px-3"
                    style={{ width: LABEL_WIDTH }}
                  >
                    <Link
                      href={`/${projectKey}/issues/${epic.key}`}
                      className="truncate rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <span className="mr-1 font-mono text-xs text-muted-foreground">
                        {epic.key}
                      </span>{" "}
                      {epic.title}
                    </Link>
                    <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      {conflicted.has(epic.id) ? (
                        <AlertTriangle aria-hidden="true" className="size-3 text-destructive" />
                      ) : null}
                      {childSummary(epic)} · {progress.label}
                    </span>
                  </div>
                  <div className="relative shrink-0" style={{ width }}>
                    <EpicBar
                      epicKey={epic.key}
                      title={epic.title}
                      range={range}
                      windowStart={frame.start}
                      dayWidth={dayWidth}
                      progress={progress}
                      conflict={conflicted.has(epic.id)}
                      describedBy={describedBy}
                      onCommit={(next) => onCommit(epic, next)}
                      onEdit={() => onEdit(epic)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
        Drag a bar to move it or its edges to change a date; or focus it and use the arrow keys
        (Shift: a week, Alt: the end date, Enter: edit the dates).
      </p>
    </section>
  );
}

function childSummary(epic: RoadmapEpic): string {
  const { total } = epic.children;
  return `${total} ${total === 1 ? "child" : "children"}`;
}

function Unscheduled({
  projectKey,
  epics,
  onEdit,
}: {
  projectKey: string;
  epics: RoadmapEpic[];
  onEdit: (epic: RoadmapEpic) => void;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-lg font-medium">
        Unscheduled{" "}
        <span className="text-sm font-normal text-muted-foreground">({epics.length})</span>
      </h2>
      {epics.length === 0 ? (
        <p className="text-sm text-muted-foreground">Every epic has a start and a due date.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {epics.map((epic) => (
            <li key={epic.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <Link
                href={`/${projectKey}/issues/${epic.key}`}
                className="min-w-0 flex-1 truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="mr-1 font-mono text-xs text-muted-foreground">{epic.key}</span>{" "}
                {epic.title}
              </Link>
              <StatusBadge name={epic.status.name} category={epic.status.category} />
              {epic.assignee ? <Avatar name={epic.assignee.name} /> : null}
              <span className="text-xs text-muted-foreground">
                {epic.startDate && epic.dueDate
                  ? `${formatDateRange(epic.startDate, epic.dueDate)} (due before it starts)`
                  : epic.startDate || epic.dueDate
                    ? formatDateRange(epic.startDate, epic.dueDate)
                    : "No dates"}{" "}
                · {epicProgress(epic.children).label}
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Set dates of ${epic.key}`}
                onClick={() => onEdit(epic)}
              >
                <CalendarPlus aria-hidden="true" />
                Set dates
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** RDM-2's accessible alternative to the arrows: every dependency as a sentence. */
function Dependencies({
  projectKey,
  dependencies,
}: {
  projectKey: string;
  dependencies: ResolvedDependency[];
}) {
  const headingId = useId();
  const issueLink = (key: string) => (
    <Link
      href={`/${projectKey}/issues/${key}`}
      className="rounded-sm font-mono outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {key}
    </Link>
  );
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-lg font-medium">
        Dependencies
      </h2>
      {dependencies.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None. Link two epics with “blocks” on an issue page to draw one.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {dependencies.map((dependency) => (
            <li
              key={dependency.linkId}
              className={cn(
                "flex flex-wrap items-center gap-1.5",
                dependency.conflict && "text-destructive",
              )}
            >
              {dependency.conflict ? (
                <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
              ) : null}
              {issueLink(dependency.blocker.key)} blocks {issueLink(dependency.blocked.key)}
              {dependency.conflict && dependency.blocker.dueDate && dependency.blocked.startDate ? (
                <span>
                  {" "}
                  — conflict: {dependency.blocker.key} is due{" "}
                  {formatShortDate(dependency.blocker.dueDate)}, {dependency.overlapDays}{" "}
                  {dependency.overlapDays === 1 ? "day" : "days"} after {dependency.blocked.key}{" "}
                  starts ({formatShortDate(dependency.blocked.startDate)})
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
