import { describe, expect, it } from "vitest";

import {
  addMonths,
  currentMonth,
  isMonth,
  localDate,
  monthLabel,
  monthsOfYear,
  monthToPeriod,
  periodToMonth,
  previousMonth,
  reminderMonth,
} from "./month";
import { entriesRange, parseCostRoute } from "./route";

describe("months (COST-2)", () => {
  it("adds months across year boundaries", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(addMonths("2025-12", 1)).toBe("2026-01");
    expect(addMonths("2026-10", -12)).toBe("2025-10");
    expect(addMonths("2026-03", -15)).toBe("2024-12");
    expect(addMonths("2026-03", 25)).toBe("2028-04");
  });

  it("validates YYYY-MM", () => {
    expect(isMonth("2026-10")).toBe(true);
    for (const bad of ["2026-13", "2026-00", "2026-1", "26-10", "2026-10-01", 202610, null]) {
      expect(isMonth(bad)).toBe(false);
    }
  });

  it("maps months to periods (the first of the month) and back", () => {
    expect(monthToPeriod("2026-10")).toBe("2026-10-01");
    expect(periodToMonth("2026-10-01")).toBe("2026-10");
    expect(monthsOfYear(2026)).toHaveLength(12);
    expect(monthsOfYear(2026)[0]).toBe("2026-01");
    expect(monthLabel("2026-10")).toBe("October 2026");
  });

  it("uses Stockkart's time zone for today (IST, UTC+5:30)", () => {
    // 20:00 UTC on 31 Oct is already 1 Nov in India.
    const late = new Date("2026-10-31T20:00:00Z");
    expect(localDate(late)).toBe("2026-11-01");
    expect(currentMonth(late)).toBe("2026-11");
    expect(localDate(late, "UTC")).toBe("2026-10-31");
  });
});

describe("reminderMonth (COST-7)", () => {
  it("is null before the reminder day and last month on or after it", () => {
    expect(reminderMonth("2026-11-02", 3)).toBeNull();
    expect(reminderMonth("2026-11-03", 3)).toBe("2026-10");
    expect(reminderMonth("2026-11-28", 3)).toBe("2026-10");
    expect(reminderMonth("2026-11-01", 1)).toBe("2026-10");
  });

  it("reminds about December in January", () => {
    expect(reminderMonth("2027-01-05", 1)).toBe("2026-12");
  });
});

describe("costs route", () => {
  it("parses the tab, month and year with safe defaults", () => {
    expect(parseCostRoute({}, "2026-10")).toEqual({ tab: "month", month: "2026-10", year: 2026 });
    expect(parseCostRoute({ tab: "year", year: "2025" }, "2026-10")).toMatchObject({
      tab: "year",
      year: 2025,
    });
    expect(parseCostRoute({ month: "2025-02" }, "2026-10")).toMatchObject({
      month: "2025-02",
      year: 2025,
    });
    expect(parseCostRoute({ tab: "evil", month: "x", year: "1" }, "2026-10")).toEqual({
      tab: "month",
      month: "2026-10",
      year: 2026,
    });
  });

  it("loads the entries each tab needs", () => {
    const month = parseCostRoute({ month: "2026-03" }, "2026-10");
    expect(entriesRange(month, "2026-10")).toEqual({ from: "2025-03", to: "2026-03" });
    const year = parseCostRoute({ tab: "year", year: "2026" }, "2026-10");
    expect(entriesRange(year, "2026-10")).toEqual({ from: "2025-02", to: "2026-12" });
    const items = parseCostRoute({ tab: "items" }, "2026-10");
    expect(entriesRange(items, "2026-10")).toEqual({ from: "2026-10", to: "2026-10" });
  });
});
