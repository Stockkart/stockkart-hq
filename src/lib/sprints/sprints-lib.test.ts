import { describe, expect, it } from "vitest";

import { statusKind } from "./constants";
import { addDays, datesInRange, formatDateRange, nextSprintDefaults } from "./dates";
import {
  boardHref,
  completeSprintInput,
  createSprintInput,
  moveIssueToSprintInput,
  parseBoardScope,
} from "./schemas";

const ID = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";

describe("sprint dates", () => {
  it("adds days across month ends and lists a range", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(datesInRange("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
    expect(datesInRange("2026-03-02", "2026-03-01")).toEqual([]);
    expect(formatDateRange("2026-06-02", "2026-06-15")).toBe("Jun 2 – Jun 15");
    expect(formatDateRange(null, null)).toBe("No dates");
  });

  it("defaults the next sprint after the latest one (SPR-1)", () => {
    expect(nextSprintDefaults([], 14, "2026-06-10")).toEqual({
      name: "Sprint 1",
      startDate: "2026-06-10",
      endDate: "2026-06-23",
    });
    expect(
      nextSprintDefaults(
        [{ endDate: "2026-06-14" }, { endDate: null }, { endDate: "2026-06-28" }],
        7,
        "2026-06-10",
      ),
    ).toEqual({ name: "Sprint 4", startDate: "2026-06-29", endDate: "2026-07-05" });
  });
});

describe("statusKind", () => {
  it("tells open, done and Won't Do apart", () => {
    expect(statusKind({ category: "in_progress", name: "In Review" })).toBe("open");
    expect(statusKind({ category: "done", name: "Done" })).toBe("done");
    expect(statusKind({ category: "done", name: "Won't Do" })).toBe("wont_do");
  });
});

describe("sprint schemas", () => {
  const base = { projectKey: "STK", name: "  Sprint   7 ", goal: "  ", startDate: "2026-06-02" };

  it("normalises the name and an empty goal", () => {
    expect(createSprintInput.parse({ ...base, endDate: "2026-06-15" })).toMatchObject({
      name: "Sprint 7",
      goal: null,
    });
  });

  it("rejects an end before the start and over-long sprints", () => {
    expect(createSprintInput.safeParse({ ...base, endDate: "2026-06-01" }).success).toBe(false);
    expect(createSprintInput.safeParse({ ...base, endDate: "2026-12-31" }).success).toBe(false);
    expect(createSprintInput.safeParse({ ...base, endDate: "2026-06-02" }).success).toBe(true);
  });

  it("accepts only known carry targets", () => {
    expect(completeSprintInput.safeParse({ sprintId: ID, carryTo: "next" }).success).toBe(true);
    expect(completeSprintInput.safeParse({ sprintId: ID, carryTo: "trash" }).success).toBe(false);
  });

  it("moves to the backlog with null and keeps the rank without afterIssueId", () => {
    expect(moveIssueToSprintInput.parse({ issueId: ID, sprintId: null })).toEqual({
      issueId: ID,
      sprintId: null,
    });
    expect(
      moveIssueToSprintInput.safeParse({ issueId: ID, sprintId: null, afterIssueId: ID }).success,
    ).toBe(false);
  });
});

describe("board scope URL param (BRD-3)", () => {
  it("defaults to the sprint and keeps 'all'", () => {
    expect(parseBoardScope({})).toBe("sprint");
    expect(parseBoardScope({ scope: "all" })).toBe("all");
    expect(parseBoardScope({ scope: ["all", "sprint"] })).toBe("all");
    expect(parseBoardScope(new URLSearchParams("scope=bogus"))).toBe("sprint");
  });

  it("writes the default as the plain URL", () => {
    expect(boardHref("STK", "sprint")).toBe("/STK/board");
    expect(boardHref("STK", "all")).toBe("/STK/board?scope=all");
  });
});
