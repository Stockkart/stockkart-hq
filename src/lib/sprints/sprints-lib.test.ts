import { describe, expect, it } from "vitest";

import { statusKind } from "./constants";
import { addDays, datesInRange, formatDateRange, nextSprintDefaults } from "./dates";
import {
  boardHref,
  completeSprintInput,
  createSprintInput,
  DEFAULT_BOARD_SELECTION,
  moveIssueToSprintInput,
  parseBoardSelection,
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

describe("board selection URL params (BRD-3)", () => {
  const SPRINT = "00000000-0000-4000-8000-000000000007";

  it("defaults to the active sprint, keeps 'all' and an open sprint id", () => {
    expect(parseBoardSelection({})).toEqual(DEFAULT_BOARD_SELECTION);
    expect(parseBoardSelection({ scope: "all" })).toEqual({ scope: "all", sprintId: null });
    expect(parseBoardSelection({ scope: ["all", "sprint"] })).toEqual({
      scope: "all",
      sprintId: null,
    });
    expect(parseBoardSelection(new URLSearchParams("scope=bogus"))).toEqual(
      DEFAULT_BOARD_SELECTION,
    );
    expect(parseBoardSelection({ sprint: SPRINT })).toEqual({ scope: "sprint", sprintId: SPRINT });
    expect(parseBoardSelection(new URLSearchParams(`sprint=${SPRINT}`)).sprintId).toBe(SPRINT);
  });

  it("drops a sprint that is not a uuid, and lets 'all' win over a sprint", () => {
    expect(parseBoardSelection({ sprint: "1 OR 1=1" })).toEqual(DEFAULT_BOARD_SELECTION);
    expect(parseBoardSelection({ scope: "all", sprint: SPRINT })).toEqual({
      scope: "all",
      sprintId: null,
    });
  });

  it("writes the default as the plain URL", () => {
    expect(boardHref("STK", DEFAULT_BOARD_SELECTION)).toBe("/STK/board");
    expect(boardHref("STK", { scope: "all", sprintId: null })).toBe("/STK/board?scope=all");
    expect(boardHref("STK", { scope: "sprint", sprintId: SPRINT })).toBe(
      `/STK/board?sprint=${SPRINT}`,
    );
    // BRD-6: the view params come along (the view's scope/sprint never override the selection).
    expect(
      boardHref(
        "STK",
        { scope: "all", sprintId: null },
        new URLSearchParams(`types=bug&scope=sprint&sprint=${SPRINT}`),
      ),
    ).toBe("/STK/board?scope=all&types=bug");
    expect(boardHref("STK", DEFAULT_BOARD_SELECTION, new URLSearchParams("hide=none"))).toBe(
      "/STK/board?hide=none",
    );
  });

  it("round-trips a selection through its URL params", () => {
    for (const selection of [
      DEFAULT_BOARD_SELECTION,
      { scope: "all" as const, sprintId: null },
      { scope: "sprint" as const, sprintId: SPRINT },
    ]) {
      const query = boardHref("STK", selection).split("?")[1] ?? "";
      expect(parseBoardSelection(new URLSearchParams(query))).toEqual(selection);
    }
  });
});
