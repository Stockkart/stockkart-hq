import { describe, expect, it } from "vitest";

import { type PlanningIssue } from "@/lib/issues/views";
import { planningSections } from "@/lib/planning/sprint-sections";
import { type SprintSummary } from "@/lib/sprints/views";

import { applySprintChange, issueMoveOf, nextPlanned } from "./sprint-state";

const tally = (count: number, points: number) => ({ count, points });
const sprint = (id: string, overrides: Partial<SprintSummary> = {}): SprintSummary => ({
  id,
  name: id,
  goal: null,
  startDate: "2026-06-01",
  endDate: "2026-06-14",
  state: "planned",
  closedAt: null,
  open: tally(0, 0),
  done: tally(0, 0),
  wontDo: tally(0, 0),
  retroDocId: null,
  ...overrides,
});

const issue = (
  n: number,
  sprintId: string | null,
  category: "todo" | "done" = "todo",
): PlanningIssue => ({
  id: `i${n}`,
  key: `STK-${n}`,
  number: n,
  title: `Issue ${n}`,
  type: "task",
  priority: 2,
  status: { id: category, name: category, category },
  assignee: null,
  component: null,
  epic: null,
  storyPoints: n,
  labels: [],
  sprintId,
  rank: `a${n}`,
  createdAt: new Date(),
  updatedAt: new Date(),
  resolvedAt: null,
});

describe("applySprintChange (optimistic sprints)", () => {
  const list = [
    sprint("active", { state: "active", open: tally(2, 5) }),
    sprint("later", { startDate: "2026-07-01" }),
    sprint("sooner", { startDate: "2026-06-15", open: tally(1, 1) }),
  ];

  it("starts and orders the active sprint first", () => {
    const result = applySprintChange(
      list.map((s) => (s.id === "active" ? { ...s, state: "closed" as const } : s)),
      { kind: "start", id: "later" },
    );
    expect(result.map((s) => [s.id, s.state])).toEqual([
      ["later", "active"],
      ["sooner", "planned"],
      ["active", "closed"],
    ]);
  });

  it("completes into the next sprint, moving the open tally", () => {
    const result = applySprintChange(list, {
      kind: "complete",
      id: "active",
      carryTo: "next",
      targetId: "sooner",
    });
    expect(result.find((s) => s.id === "active")).toMatchObject({
      state: "closed",
      open: tally(0, 0),
    });
    expect(result.find((s) => s.id === "sooner")?.open).toEqual(tally(3, 6));
  });

  it("finds the next planned sprint by start date", () => {
    expect(nextPlanned(list)?.id).toBe("sooner");
    expect(nextPlanned(list, "sooner")?.id).toBe("later");
  });

  it("knows which issues a delete or completion moves", () => {
    expect(issueMoveOf({ kind: "remove", id: "s" })).toEqual({
      from: "s",
      to: null,
      openOnly: false,
    });
    expect(issueMoveOf({ kind: "complete", id: "s", carryTo: "backlog", targetId: "t" })).toEqual({
      from: "s",
      to: null,
      openOnly: true,
    });
    expect(issueMoveOf({ kind: "start", id: "s" })).toBeNull();
  });
});

describe("planningSections (BLG-3)", () => {
  const sprints = [
    sprint("planned-b", { startDate: "2026-07-01" }),
    sprint("active", { state: "active" }),
    sprint("closed", { state: "closed" }),
    sprint("planned-a", { startDate: "2026-06-15" }),
  ];
  const issues = [
    issue(1, "active", "done"),
    issue(2, null),
    issue(3, "planned-a"),
    issue(4, "planned-a", "done"),
    issue(5, "closed"),
    issue(6, "active"),
  ];

  it("orders active, then planned as given, then the backlog", () => {
    const sections = planningSections(issues, sprints, "none");
    expect(sections.map((s) => s.id)).toEqual(["active", "planned-b", "planned-a", "backlog:none"]);
  });

  it("shows all active issues, only not-done planned ones, and the rest in the backlog", () => {
    const [active, , plannedA, backlog] = planningSections(issues, sprints, "none");
    expect(active?.issues.map((i) => i.id)).toEqual(["i1", "i6"]);
    expect(active?.points).toBe(7);
    expect(plannedA?.issues.map((i) => i.id)).toEqual(["i3"]);
    expect(backlog?.issues.map((i) => i.id)).toEqual(["i2", "i5"]);
  });

  it("keeps an empty backlog section", () => {
    const sections = planningSections([issue(6, "active")], sprints, "assignee");
    expect(sections.at(-1)).toMatchObject({ id: "backlog:none", issues: [] });
  });
});
