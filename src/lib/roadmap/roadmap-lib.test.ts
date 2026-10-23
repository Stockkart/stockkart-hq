import { describe, expect, it } from "vitest";

import { isConflict, resolveDependencies } from "./dependencies";
import { parseRoadmapParams, roadmapSearchParams } from "./filters";
import { epicProgress } from "./progress";
import { applyBarEdit, dragDays, keyboardBarEdit } from "./schedule";
import { startOfQuarter, startOfWeek, timelineTicks, timelineWindow } from "./timeline";
import { type ChildTally } from "./views";

const tally = (overrides: Partial<ChildTally> = {}): ChildTally => ({
  total: 0,
  done: 0,
  wontDo: 0,
  points: 0,
  donePoints: 0,
  pointed: 0,
  ...overrides,
});

describe("epicProgress (RDM-1)", () => {
  it("is the share of done points among the children's points, rounded down", () => {
    expect(
      epicProgress(tally({ total: 4, done: 2, points: 13, donePoints: 8, pointed: 4 })),
    ).toEqual({ percent: 61, basis: "points", label: "8 / 13 pts" });
  });

  it("is 100% only when every counted point is done", () => {
    expect(
      epicProgress(tally({ total: 3, done: 3, points: 5, donePoints: 5, pointed: 3 })).percent,
    ).toBe(100);
  });

  it("leaves Won't Do out of both the done points and the total (the query sums so)", () => {
    // Two children: 5 pts done, 3 pts open; a third (8 pts) is Won't Do and not summed.
    const progress = epicProgress(
      tally({ total: 3, done: 1, wontDo: 1, points: 8, donePoints: 5, pointed: 2 }),
    );
    expect(progress).toEqual({ percent: 62, basis: "points", label: "5 / 8 pts" });
  });

  it("falls back to the share of done children when no child has points", () => {
    expect(epicProgress(tally({ total: 5, done: 2, wontDo: 1 }))).toEqual({
      percent: 50,
      basis: "issues",
      label: "2 / 4 issues",
    });
  });

  it("has no progress without children, or with only Won't Do ones", () => {
    expect(epicProgress(tally())).toEqual({
      percent: null,
      basis: "none",
      label: "No child issues",
    });
    expect(epicProgress(tally({ total: 2, wontDo: 2 }))).toMatchObject({
      percent: null,
      label: "Only Won't Do children",
    });
  });
});

describe("bar edits (RDM-1)", () => {
  const range = { start: "2026-06-01", end: "2026-06-14" };

  it("moves both dates and keeps the length", () => {
    expect(applyBarEdit(range, { kind: "move", days: 3 })).toEqual({
      start: "2026-06-04",
      end: "2026-06-17",
    });
    expect(applyBarEdit(range, { kind: "move", days: -7 })).toEqual({
      start: "2026-05-25",
      end: "2026-06-07",
    });
  });

  it("resizes one end, never past the other (a bar is at least a day)", () => {
    expect(applyBarEdit(range, { kind: "resizeEnd", days: 2 })).toEqual({
      start: "2026-06-01",
      end: "2026-06-16",
    });
    expect(applyBarEdit(range, { kind: "resizeEnd", days: -30 })).toEqual({
      start: "2026-06-01",
      end: "2026-06-01",
    });
    expect(applyBarEdit(range, { kind: "resizeStart", days: 30 })).toEqual({
      start: "2026-06-14",
      end: "2026-06-14",
    });
  });

  it("maps arrows to a day, Shift to a week and Alt to the end date", () => {
    const key = (key: string, mods: { shiftKey?: boolean; altKey?: boolean } = {}) =>
      keyboardBarEdit({ key, shiftKey: false, altKey: false, ...mods });
    expect(key("ArrowRight")).toEqual({ kind: "move", days: 1 });
    expect(key("ArrowLeft")).toEqual({ kind: "move", days: -1 });
    expect(key("ArrowRight", { shiftKey: true })).toEqual({ kind: "move", days: 7 });
    expect(key("ArrowLeft", { altKey: true })).toEqual({ kind: "resizeEnd", days: -1 });
    expect(key("ArrowRight", { altKey: true, shiftKey: true })).toEqual({
      kind: "resizeEnd",
      days: 7,
    });
    expect(key("ArrowUp")).toBeNull();
    expect(key("Enter")).toBeNull();
    expect(
      keyboardBarEdit({ key: "ArrowRight", shiftKey: false, altKey: false, ctrlKey: true }),
    ).toBeNull();
  });

  it("snaps a pointer drag to whole days", () => {
    expect(dragDays(40, 8)).toBe(5);
    expect(dragDays(3, 8)).toBe(0);
    expect(dragDays(-13, 8)).toBe(-2);
  });
});

describe("dependency conflicts (RDM-2)", () => {
  const epic = (id: string, startDate: string | null, dueDate: string | null) => ({
    id,
    key: `STK-${id}`,
    startDate,
    dueDate,
  });

  it("is a conflict when the blocker is due after the blocked epic starts", () => {
    expect(isConflict(epic("30", "2026-06-01", "2026-06-20"), epic("41", "2026-06-15", null))).toBe(
      true,
    );
  });

  it("is no conflict when the blocker ends before, or on, the blocked start day", () => {
    expect(isConflict(epic("30", null, "2026-06-14"), epic("41", "2026-06-15", null))).toBe(false);
    expect(isConflict(epic("30", null, "2026-06-15"), epic("41", "2026-06-15", null))).toBe(false);
  });

  it("never flags undated epics", () => {
    expect(isConflict(epic("30", null, null), epic("41", "2026-06-15", null))).toBe(false);
    expect(isConflict(epic("30", null, "2026-06-20"), epic("41", null, "2026-07-01"))).toBe(false);
  });

  it("resolves only links whose two epics are shown, with the overlap", () => {
    const epics = [
      epic("30", "2026-06-01", "2026-06-20"),
      epic("41", "2026-06-15", "2026-06-30"),
      epic("50", "2026-07-01", "2026-07-10"),
    ];
    const resolved = resolveDependencies(
      [
        { linkId: "a", blockerId: "30", blockedId: "41" },
        { linkId: "b", blockerId: "41", blockedId: "50" },
        { linkId: "c", blockerId: "30", blockedId: "hidden" },
      ],
      epics,
    );
    expect(resolved.map((d) => [d.linkId, d.conflict, d.overlapDays])).toEqual([
      ["a", true, 5],
      ["b", false, 0],
    ]);
  });
});

describe("timeline geometry", () => {
  it("aligns weeks to Monday and quarters to their first day", () => {
    expect(startOfWeek("2026-06-03")).toBe("2026-06-01");
    expect(startOfWeek("2026-06-07")).toBe("2026-06-01");
    expect(startOfQuarter("2026-08-19")).toBe("2026-07-01");
  });

  it("covers every bar and today, with a unit of room and a minimum width", () => {
    const frame = timelineWindow(
      [{ start: "2026-06-10", end: "2026-07-20" }],
      "2026-06-15",
      "month",
    );
    expect(frame.start).toBe("2026-05-01");
    expect(frame.end >= "2026-08-31").toBe(true);
    expect(timelineTicks(frame, "month").map((t) => t.label)[0]).toBe("May 2026");
    const week = timelineWindow([], "2026-06-03", "week");
    expect(week.start).toBe("2026-05-25");
    expect(timelineTicks(week, "week")).toHaveLength(10);
    expect(timelineTicks(timelineWindow([], "2026-06-03", "quarter"), "quarter")[0]?.label).toBe(
      "Q1 2026",
    );
  });
});

describe("roadmap URL params", () => {
  const C = "0f1e2d3c-4b5a-4968-8776-5544332211aa";

  it("parses zoom and filters, dropping anything invalid", () => {
    expect(
      parseRoadmapParams({
        zoom: "quarter",
        component: `${C},nope`,
        assignee: "me,none,bob",
        category: "done,later",
      }),
    ).toEqual({
      zoom: "quarter",
      filters: { components: [C], assignees: ["me", "none"], categories: ["done"] },
    });
    expect(parseRoadmapParams({ zoom: "decade" }).zoom).toBe("month");
  });

  it("writes only what differs from the defaults, and reads it back", () => {
    const view = parseRoadmapParams({ zoom: "week", category: "todo,in_progress" });
    const query = roadmapSearchParams(view);
    expect(query.toString()).toBe("zoom=week&category=todo%2Cin_progress");
    expect(parseRoadmapParams(query)).toEqual(view);
    expect(roadmapSearchParams(parseRoadmapParams({})).toString()).toBe("");
  });
});
