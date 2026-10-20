import { type StatusKind, VELOCITY_SPRINTS } from "./constants";
import { datesInRange, endOfDay, formatShortDate } from "./dates";
import { type Burndown, type BurndownPoint, type VelocityBar } from "./views";

/**
 * SPR-3 burndown and SPR-4 velocity, reconstructed from the activity log (no cron, no
 * daily snapshots). Pure and isomorphic: the server reads the rows in one batch and calls
 * these; the unit tests feed them synthetic activity.
 *
 * Model: an issue's state at instant T is its CURRENT state with every change made after T
 * undone (newest first, restoring each change's `from` value). Sprint membership after the
 * start comes from the start snapshot (`sprint_started.meta.issueIds`) plus the sprint
 * field changes since; before the start (or without a snapshot) it is replayed like any
 * other field. An issue counts only while it exists (created, not yet deleted).
 *
 * For each sprint day the state at the end of that day (UTC) is used; the day the sprint
 * was closed uses the instant just before closing, so the open issues carried out by the
 * completion still count as remaining on the last point. Points: unestimated issues are 0.
 *
 * - remaining: points of member issues whose status is not done-category;
 * - completed: points in a done status other than Won't Do;
 * - scope: remaining + completed. Won't Do leaves the scope (and the remaining work) and is
 *   never counted as completed; neither is it in velocity (§4.4).
 */

export interface BurndownIssue {
  id: string;
  createdAt: Date;
  /** Soft-delete time; the issue stops counting from then on. */
  deletedAt: Date | null;
  /** Current values. */
  sprintId: string | null;
  statusId: string;
  points: number | null;
}

export type TrackedField = "sprint" | "status" | "storyPoints";

/** One `activity` row of an issue field change (raw text values, as stored). */
export interface IssueChange {
  issueId: string;
  at: Date;
  field: TrackedField;
  from: string | null;
  to: string | null;
}

export interface SprintTimeline {
  sprintId: string;
  name: string;
  /** ISO dates. */
  startDate: string;
  endDate: string;
  /** When `sprint_started` was logged; null for a sprint that never started. */
  startedAt: Date | null;
  closedAt: Date | null;
  /** `sprint_started.meta.issueIds`; null when missing (older data). */
  snapshotIssueIds: readonly string[] | null;
}

export interface BurndownData {
  issues: readonly BurndownIssue[];
  changes: readonly IssueChange[];
  /** Every status id of the project → how it counts (see `statusKind`). */
  statusKinds: ReadonlyMap<string, StatusKind>;
}

interface Totals {
  remaining: number;
  completed: number;
  scope: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

function parsePoints(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Builds the state-at-T evaluator for one sprint. */
function evaluator(timeline: SprintTimeline, data: BurndownData) {
  const byIssue = new Map<string, IssueChange[]>();
  for (const change of data.changes) {
    const list = byIssue.get(change.issueId) ?? [];
    list.push(change);
    byIssue.set(change.issueId, list);
  }
  // Newest first, so undoing walks back in time.
  for (const list of byIssue.values()) list.sort((a, b) => b.at.getTime() - a.at.getTime());
  const sprintChanges = data.changes
    .filter((change) => change.field === "sprint")
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const { sprintId, startedAt, snapshotIssueIds } = timeline;

  function stateAt(issue: BurndownIssue, at: number) {
    let sprint = issue.sprintId;
    let status = issue.statusId;
    let points = issue.points;
    for (const change of byIssue.get(issue.id) ?? []) {
      if (change.at.getTime() <= at) break;
      if (change.field === "sprint") sprint = change.from;
      else if (change.field === "status" && change.from !== null) status = change.from;
      else if (change.field === "storyPoints") points = parsePoints(change.from);
    }
    return { sprint, status, points };
  }

  /** Members by the start snapshot plus the sprint changes after the start. */
  function snapshotMembers(at: number): Set<string> | null {
    if (!snapshotIssueIds || !startedAt || at < startedAt.getTime()) return null;
    const members = new Set(snapshotIssueIds);
    for (const change of sprintChanges) {
      const time = change.at.getTime();
      if (time <= startedAt.getTime()) continue;
      if (time > at) break;
      if (change.to === sprintId) members.add(change.issueId);
      else if (change.from === sprintId) members.delete(change.issueId);
    }
    return members;
  }

  return (at: number): Totals => {
    const members = snapshotMembers(at);
    const totals: Totals = { remaining: 0, completed: 0, scope: 0 };
    for (const issue of data.issues) {
      if (issue.createdAt.getTime() > at) continue;
      if (issue.deletedAt && issue.deletedAt.getTime() <= at) continue;
      const state = stateAt(issue, at);
      const member = members ? members.has(issue.id) : state.sprint === sprintId;
      if (!member) continue;
      const points = state.points ?? 0;
      const kind = data.statusKinds.get(state.status) ?? "open";
      if (kind === "open") totals.remaining += points;
      else if (kind === "done") totals.completed += points;
    }
    totals.scope = totals.remaining + totals.completed;
    return totals;
  };
}

/** The last instant the sprint's own data describes: just before closing, or now. */
const lastInstant = (timeline: SprintTimeline, now: Date) =>
  timeline.closedAt ? timeline.closedAt.getTime() - 1 : now.getTime();

/**
 * The burndown of a started sprint: a `start` point (the committed scope) and one point per
 * sprint day, empty (null) for days still to come. Null for a sprint that never started.
 */
export function computeBurndown(
  timeline: SprintTimeline,
  data: BurndownData,
  now: Date,
): Burndown | null {
  const { startedAt } = timeline;
  if (!startedAt) return null;
  const totalsAt = evaluator(timeline, data);
  const start = startedAt.getTime();
  const last = Math.max(start, lastInstant(timeline, now));
  const committed = totalsAt(start).scope;
  const dates = datesInRange(timeline.startDate, timeline.endDate);
  const count = Math.max(1, dates.length);

  const points: BurndownPoint[] = [
    {
      key: "start",
      label: "Start",
      remaining: committed,
      scope: committed,
      completed: totalsAt(start).completed,
      ideal: committed,
    },
  ];
  dates.forEach((date, index) => {
    const ideal = round(committed * (1 - (index + 1) / count));
    const dayEnd = endOfDay(date).getTime();
    const dayStart = dayEnd + 1 - 24 * 60 * 60 * 1000;
    if (dayStart > last) {
      points.push({
        key: date,
        label: formatShortDate(date),
        remaining: null,
        scope: null,
        completed: null,
        ideal,
      });
      return;
    }
    const totals = totalsAt(Math.max(start, Math.min(dayEnd, last)));
    points.push({ key: date, label: formatShortDate(date), ...totals, ideal });
  });
  return { committed, points };
}

/**
 * SPR-4: completed points (Done, not Won't Do) of each closed sprint at the moment it was
 * closed, for the last `VELOCITY_SPRINTS`, oldest first.
 */
export function computeVelocity(
  sprints: readonly SprintTimeline[],
  data: BurndownData,
): VelocityBar[] {
  return sprints
    .filter((sprint): sprint is SprintTimeline & { closedAt: Date } => sprint.closedAt !== null)
    .sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime())
    .slice(-VELOCITY_SPRINTS)
    .map((sprint) => ({
      sprintId: sprint.sprintId,
      name: sprint.name,
      completed: evaluator(sprint, data)(sprint.closedAt.getTime() - 1).completed,
    }));
}
