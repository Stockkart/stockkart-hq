import { type StatusKind, VELOCITY_SPRINTS } from "./constants";
import { datesInRange, endOfDay, formatShortDate } from "./dates";
import { type Burndown, type BurndownPoint, type VelocityBar } from "./views";

/**
 * SPR-3 burndown and SPR-4 velocity, reconstructed from the activity log (no cron, no
 * daily snapshots). Pure and isomorphic: the server reads the rows in one batch and calls
 * these; the unit tests feed them synthetic activity.
 *
 * Model: an issue's state at instant T is its CURRENT state with every change made after T
 * undone (newest first, restoring each change's `from` value); sprint membership is
 * replayed the same way (see `isMember`), with the start snapshot
 * (`sprint_started.meta.memberIds`) as the fallback for issues without sprint changes. An
 * issue counts only while it exists (created, not yet deleted).
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
  /**
   * The sprint's live issues when it started (`sprint_started.meta.memberIds`, done ones
   * included; `issueIds`, the open ones, for older rows); null when missing.
   */
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
  // Each issue's sprint changes, oldest first.
  const sprintChanges = new Map<string, IssueChange[]>();
  for (const [issueId, list] of byIssue) {
    sprintChanges.set(issueId, list.filter((change) => change.field === "sprint").reverse());
  }
  const { sprintId, startedAt } = timeline;
  const snapshot = timeline.snapshotIssueIds ? new Set(timeline.snapshotIssueIds) : null;

  function stateAt(issue: BurndownIssue, at: number) {
    let status = issue.statusId;
    let points = issue.points;
    for (const change of byIssue.get(issue.id) ?? []) {
      if (change.at.getTime() <= at) break;
      if (change.field === "status" && change.from !== null) status = change.from;
      else if (change.field === "storyPoints") points = parsePoints(change.from);
    }
    return { status, points };
  }

  /**
   * Sprint membership at `at`, from the issue's sprint changes: the latest one at or before
   * `at` decides, else the `from` of the first later one. Only an issue with no sprint
   * change at all falls back to the start snapshot (once started; it guards against a
   * membership change that left no activity row) or to its current sprint. Using every
   * change, not only those after the start, keeps a move that raced the start correct on
   * whichever side of the snapshot it landed.
   */
  function isMember(issue: BurndownIssue, at: number): boolean {
    let last: IssueChange | undefined;
    let next: IssueChange | undefined;
    for (const change of sprintChanges.get(issue.id) ?? []) {
      if (change.at.getTime() > at) {
        next = change;
        break;
      }
      last = change;
    }
    if (last) return last.to === sprintId;
    // No change yet: the first later change says what it was before.
    if (next) return next.from === sprintId;
    if (snapshot && startedAt && at >= startedAt.getTime()) return snapshot.has(issue.id);
    return issue.sprintId === sprintId;
  }

  return (at: number): Totals => {
    const totals: Totals = { remaining: 0, completed: 0, scope: 0 };
    for (const issue of data.issues) {
      if (issue.createdAt.getTime() > at) continue;
      if (issue.deletedAt && issue.deletedAt.getTime() <= at) continue;
      if (!isMember(issue, at)) continue;
      const state = stateAt(issue, at);
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
 * The burndown of a started sprint: a `start` point, one point per sprint day (empty, null,
 * for days still to come) and, for a sprint closed after its end date, a final `closed`
 * point (the state just before closing, which velocity uses too). `committed` and the ideal
 * line are the open points at the start. Null for a sprint that never started.
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
  const atStart = totalsAt(start);
  const committed = atStart.remaining;
  const dates = datesInRange(timeline.startDate, timeline.endDate);
  const count = Math.max(1, dates.length);

  const points: BurndownPoint[] = [{ key: "start", label: "Start", ...atStart, ideal: committed }];
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
  const lastDay = dates.at(-1);
  if (timeline.closedAt && lastDay && last > endOfDay(lastDay).getTime()) {
    points.push({ key: "closed", label: "Closed", ...totalsAt(last), ideal: 0 });
  }
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
