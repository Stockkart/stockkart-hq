import { describe, expect, it } from "vitest";

import {
  type BurndownData,
  type BurndownIssue,
  computeBurndown,
  computeVelocity,
  type IssueChange,
  type SprintTimeline,
} from "./burndown";
import { type StatusKind } from "./constants";

/** Synthetic activity only (S-7): a five-day sprint, June 1–5, started June 1 at 09:00 UTC. */
const S = "sprint-1";
const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 5, day, hour));
const statusKinds = new Map<string, StatusKind>([
  ["todo", "open"],
  ["doing", "open"],
  ["done", "done"],
  ["wont", "wont_do"],
]);

const timeline = (overrides: Partial<SprintTimeline> = {}): SprintTimeline => ({
  sprintId: S,
  name: "Sprint 1",
  startDate: "2026-06-01",
  endDate: "2026-06-05",
  startedAt: at(1, 9),
  closedAt: null,
  snapshotIssueIds: null,
  ...overrides,
});

const issue = (id: string, overrides: Partial<BurndownIssue> = {}): BurndownIssue => ({
  id,
  createdAt: at(1, 0),
  deletedAt: null,
  sprintId: S,
  statusId: "todo",
  points: 3,
  ...overrides,
});

const change = (
  issueId: string,
  when: Date,
  field: IssueChange["field"],
  from: string | null,
  to: string | null,
): IssueChange => ({ issueId, at: when, field, from, to });

const data = (issues: BurndownIssue[], changes: IssueChange[] = []): BurndownData => ({
  issues,
  changes,
  statusKinds,
});

/** Remaining points per day (end of day), without the start point. */
const remainingByDay = (result: ReturnType<typeof computeBurndown>) =>
  result?.points.slice(1).map((point) => point.remaining);
const scopeByDay = (result: ReturnType<typeof computeBurndown>) =>
  result?.points.slice(1).map((point) => point.scope);

const AFTER = at(6, 12);

describe("computeBurndown (SPR-3)", () => {
  it("starts at the committed points and draws the ideal line to zero", () => {
    const result = computeBurndown(
      timeline(),
      data([issue("a", { points: 5 }), issue("b", { points: 5 })]),
      AFTER,
    );
    expect(result?.committed).toBe(10);
    expect(result?.points[0]).toMatchObject({ key: "start", remaining: 10, ideal: 10 });
    expect(result?.points.slice(1).map((point) => point.ideal)).toEqual([8, 6, 4, 2, 0]);
    expect(result?.points.slice(1).map((point) => point.key)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
    ]);
  });

  it("burns down when an issue is done", () => {
    const result = computeBurndown(
      timeline(),
      data(
        [issue("a", { statusId: "done" }), issue("b")],
        [change("a", at(3), "status", "todo", "done")],
      ),
      AFTER,
    );
    expect(remainingByDay(result)).toEqual([6, 6, 3, 3, 3]);
    expect(result?.points.at(-1)?.completed).toBe(3);
  });

  it("shows a scope increase for an issue added mid-sprint", () => {
    const result = computeBurndown(
      timeline({ snapshotIssueIds: ["a"] }),
      data([issue("a"), issue("c", { points: 2 })], [change("c", at(2), "sprint", null, S)]),
      AFTER,
    );
    expect(result?.committed).toBe(3);
    expect(scopeByDay(result)).toEqual([3, 5, 5, 5, 5]);
    expect(remainingByDay(result)).toEqual([3, 5, 5, 5, 5]);
  });

  it("counts an issue created in the sprint from its creation", () => {
    const result = computeBurndown(
      timeline({ snapshotIssueIds: ["a"] }),
      data(
        [issue("a"), issue("new", { createdAt: at(3), points: 1 })],
        [change("new", at(3), "sprint", null, S)],
      ),
      AFTER,
    );
    expect(remainingByDay(result)).toEqual([3, 3, 4, 4, 4]);
  });

  it("drops an issue removed mid-sprint from scope and remaining", () => {
    const result = computeBurndown(
      timeline({ snapshotIssueIds: ["a", "b"] }),
      data(
        [issue("a"), issue("b", { sprintId: null, points: 5 })],
        [change("b", at(3), "sprint", S, null)],
      ),
      AFTER,
    );
    expect(result?.committed).toBe(8);
    expect(remainingByDay(result)).toEqual([8, 8, 3, 3, 3]);
    expect(scopeByDay(result)).toEqual([8, 8, 3, 3, 3]);
  });

  it("adds a re-opened issue back to the remaining work", () => {
    const result = computeBurndown(
      timeline(),
      data(
        [issue("a", { statusId: "doing" })],
        [
          change("a", at(2), "status", "todo", "done"),
          change("a", at(4), "status", "done", "doing"),
        ],
      ),
      AFTER,
    );
    expect(remainingByDay(result)).toEqual([3, 0, 0, 3, 3]);
    expect(result?.points.map((point) => point.completed)).toEqual([0, 0, 3, 3, 0, 0]);
  });

  it("follows story point changes", () => {
    const result = computeBurndown(
      timeline(),
      data([issue("a", { points: 8 })], [change("a", at(3), "storyPoints", "3", "8")]),
      AFTER,
    );
    expect(result?.committed).toBe(3);
    expect(remainingByDay(result)).toEqual([3, 3, 8, 8, 8]);
  });

  it("treats an issue estimated during the sprint as 0 before", () => {
    const result = computeBurndown(
      timeline(),
      data([issue("a", { points: 2 })], [change("a", at(2), "storyPoints", null, "2")]),
      AFTER,
    );
    expect(remainingByDay(result)).toEqual([0, 2, 2, 2, 2]);
  });

  it("counts Won't Do as removed scope, never as completed", () => {
    const result = computeBurndown(
      timeline(),
      data(
        [issue("a", { statusId: "wont" }), issue("b", { points: 5 })],
        [change("a", at(2), "status", "todo", "wont")],
      ),
      AFTER,
    );
    expect(remainingByDay(result)).toEqual([8, 5, 5, 5, 5]);
    expect(scopeByDay(result)).toEqual([8, 5, 5, 5, 5]);
    expect(result?.points.every((point) => point.completed === 0)).toBe(true);
  });

  it("stops counting a deleted issue", () => {
    const result = computeBurndown(
      timeline(),
      data([issue("a"), issue("b", { deletedAt: at(2) })]),
      AFTER,
    );
    expect(remainingByDay(result)).toEqual([6, 3, 3, 3, 3]);
  });

  it("leaves days still to come empty", () => {
    const result = computeBurndown(timeline(), data([issue("a")]), at(3, 8));
    expect(remainingByDay(result)).toEqual([3, 3, 3, null, null]);
  });

  it("keeps the issues carried out at completion in the last point", () => {
    const closedAt = at(5, 18);
    const result = computeBurndown(
      timeline({ closedAt, snapshotIssueIds: ["a", "b"] }),
      data(
        [issue("a", { statusId: "done" }), issue("b", { sprintId: "sprint-2" })],
        [
          change("a", at(4), "status", "todo", "done"),
          // The completion moves the open issue in the same transaction (same timestamp).
          change("b", closedAt, "sprint", S, "sprint-2"),
        ],
      ),
      AFTER,
    );
    expect(remainingByDay(result)).toEqual([6, 6, 6, 3, 3]);
  });

  it("replays membership without a start snapshot", () => {
    const result = computeBurndown(
      timeline(),
      data([issue("a"), issue("b", { sprintId: null })], [change("b", at(3), "sprint", S, null)]),
      AFTER,
    );
    expect(remainingByDay(result)).toEqual([6, 6, 3, 3, 3]);
  });

  it("is null for a sprint that never started", () => {
    expect(computeBurndown(timeline({ startedAt: null }), data([issue("a")]), AFTER)).toBeNull();
  });
});

describe("computeVelocity (SPR-4)", () => {
  const closed = (index: number): SprintTimeline =>
    timeline({
      sprintId: `s${index}`,
      name: `Sprint ${index}`,
      startedAt: at(1, 9),
      closedAt: new Date(Date.UTC(2026, 5, 5, 18, index)),
      snapshotIssueIds: null,
    });

  it("sums the Done points at closing, excluding Won't Do and open issues", () => {
    const sprint = closed(1);
    const result = computeVelocity(
      [sprint],
      data([
        issue("done", { sprintId: "s1", statusId: "done", points: 5 }),
        issue("wont", { sprintId: "s1", statusId: "wont", points: 8 }),
        issue("open", { sprintId: "s1", statusId: "todo", points: 2 }),
        issue("other", { sprintId: "s2", statusId: "done", points: 13 }),
      ]),
    );
    expect(result).toEqual([{ sprintId: "s1", name: "Sprint 1", completed: 5 }]);
  });

  it("ignores changes made after the sprint closed", () => {
    const sprint = closed(1);
    const result = computeVelocity(
      [sprint],
      data(
        [issue("a", { sprintId: "s1", statusId: "todo", points: 5 })],
        [change("a", at(7), "status", "done", "todo")],
      ),
    );
    expect(result[0]?.completed).toBe(5);
  });

  it("keeps the last six closed sprints, oldest first", () => {
    const sprints = [3, 1, 7, 2, 5, 4, 6].map(closed);
    const result = computeVelocity([...sprints, timeline({ sprintId: "open" })], data([]));
    expect(result.map((bar) => bar.name)).toEqual([
      "Sprint 2",
      "Sprint 3",
      "Sprint 4",
      "Sprint 5",
      "Sprint 6",
      "Sprint 7",
    ]);
  });
});
