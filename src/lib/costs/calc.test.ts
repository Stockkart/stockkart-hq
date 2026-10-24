import { describe, expect, it } from "vitest";

import { fakeEntry, fakeItem } from "@/test/cost-fixtures";

import {
  buildMonthView,
  buildYearGrid,
  copyLastMonthPlan,
  indexEntries,
  isExpectedInMonth,
  monthTotals,
  yearlyRunRate,
} from "./calc";
import { monthShortLabel } from "./month";

describe("month view (COST-4)", () => {
  const hosting = fakeItem({ name: "Hosting", billingCycle: "monthly" });
  const ocr = fakeItem({ name: "OCR", category: "ai_ocr", billingCycle: "usage" });
  const domain = fakeItem({
    name: "Domain",
    category: "domain_dns",
    billingCycle: "yearly",
    renewsOn: "2026-03-15",
  });
  const old = fakeItem({ name: "Old tool", active: false });
  const items = [hosting, ocr, domain, old];
  const entries = [
    fakeEntry(hosting, "2026-09", 100000),
    fakeEntry(hosting, "2026-10", 110000),
    fakeEntry(ocr, "2026-09", 20000),
    fakeEntry(ocr, "2026-10", 30000, "estimate"),
    fakeEntry(domain, "2026-03", 120000),
    fakeEntry(old, "2026-10", 5000),
  ];

  it("totals cash out and IMR (yearly ÷ 12 in the run-rate only)", () => {
    const totals = monthTotals(items, indexEntries(entries), "2026-10");
    expect(totals.cashOut).toBe(110000 + 30000 + 5000);
    expect(totals.imr).toBe(110000 + 30000 + 5000 + 10000);
    expect(totals.actual).toBe(115000);
    expect(totals.estimate).toBe(30000);
    // In March the domain is paid in full (cash) and still 1/12 of it in the IMR.
    const march = monthTotals(items, indexEntries(entries), "2026-03");
    expect(march.cashOut).toBe(120000);
    expect(march.imr).toBe(10000);
  });

  it("rows: active items plus archived ones paid this month, with change vs last month", () => {
    const view = buildMonthView({
      items,
      entries,
      month: "2026-10",
      runRate: false,
      budgetMinor: 140000,
    });
    expect(view.rows.map((row) => row.item.name)).toEqual(["Hosting", "OCR", "Domain", "Old tool"]);
    const [hostingRow, ocrRow, domainRow] = view.rows;
    expect(hostingRow?.change).toBe(10);
    expect(ocrRow?.change).toBe(50);
    // Yearly items show in the month paid (cash); not October.
    expect(domainRow?.value).toBeNull();
    expect(domainRow?.due).toBe(false);
    expect(view.imrChange).toBe(percent(155000, 130000));
    expect(view.budget).toEqual({ budget: 140000, ratio: 155000 / 140000, over: true });
    expect(view.missing).toEqual([]);
  });

  it("spreads yearly items with the run-rate toggle", () => {
    const view = buildMonthView({
      items,
      entries,
      month: "2026-10",
      runRate: true,
      budgetMinor: null,
    });
    const domainRow = view.rows.find((row) => row.item.name === "Domain");
    expect(domainRow?.value).toBe(10000);
    expect(domainRow?.change).toBe(0);
    expect(view.budget).toBeNull();
  });

  it("counts a yearly payment for the 12 months up to and including its month only", () => {
    const index = indexEntries(entries);
    expect(yearlyRunRate(index, domain.id, "2026-02")).toBeNull();
    expect(yearlyRunRate(index, domain.id, "2026-03")).toBe(10000);
    expect(yearlyRunRate(index, domain.id, "2027-02")).toBe(10000);
    expect(yearlyRunRate(index, domain.id, "2027-03")).toBeNull();
  });

  it("lists expected items without an entry as missing", () => {
    const view = buildMonthView({
      items,
      entries,
      month: "2026-11",
      runRate: false,
      budgetMinor: null,
    });
    expect(view.missing.map((item) => item.name)).toEqual(["Hosting", "OCR"]);
    const march = buildMonthView({
      items,
      entries: [],
      month: "2027-03",
      runRate: false,
      budgetMinor: null,
    });
    expect(march.missing.map((item) => item.name)).toEqual(["Hosting", "OCR", "Domain"]);
  });

  it("is under budget up to the budget itself", () => {
    const view = buildMonthView({
      items: [hosting],
      entries: [fakeEntry(hosting, "2026-10", 50000)],
      month: "2026-10",
      runRate: false,
      budgetMinor: 50000,
    });
    expect(view.budget).toEqual({ budget: 50000, ratio: 1, over: false });
  });
});

describe("isExpectedInMonth (COST-7)", () => {
  it("expects monthly and usage items every month from the month they were added", () => {
    const item = fakeItem({ createdMonth: "2026-10" });
    expect(isExpectedInMonth(item, "2026-09")).toBe(false);
    expect(isExpectedInMonth(item, "2026-10")).toBe(true);
    expect(isExpectedInMonth({ ...item, active: false }, "2026-11")).toBe(false);
  });

  it("expects yearly items only in their renewal month", () => {
    const item = fakeItem({ billingCycle: "yearly", renewsOn: "2025-12-20" });
    expect(isExpectedInMonth(item, "2026-12")).toBe(true);
    expect(isExpectedInMonth(item, "2026-11")).toBe(false);
    expect(isExpectedInMonth({ ...item, renewsOn: null }, "2026-12")).toBe(false);
  });
});

describe("year grid (COST-5)", () => {
  const a = fakeItem({ name: "A", category: "hosting" });
  const b = fakeItem({ name: "B", category: "database" });
  const y = fakeItem({ name: "Y", category: "domain_dns", billingCycle: "yearly" });
  const entries = [
    fakeEntry(a, "2026-01", 1000),
    fakeEntry(a, "2026-02", 2000),
    fakeEntry(b, "2026-02", 500),
    fakeEntry(y, "2026-03", 1200),
    fakeEntry(y, "2025-06", 2400), // last year's payment: run-rate until May 2026
  ];

  it("has row and column totals, the year total, the highest month and averages", () => {
    const grid = buildYearGrid({
      items: [a, b, y],
      entries,
      year: 2026,
      runRate: false,
      currentMonth: "2026-04",
      monthLabel: monthShortLabel,
    });
    expect(grid.rows.map((row) => row.total)).toEqual([3000, 500, 1200]);
    expect(grid.columnTotals.slice(0, 4)).toEqual([1000, 2500, 1200, 0]);
    expect(grid.yearTotal).toBe(4700);
    expect(grid.highest).toEqual({ month: "2026-02", total: 2500 });
    // IMR Jan…Apr: 1000+200, 2500+200, 0+100 (latest payment, March), 0+100.
    expect(grid.averageImr).toBe(Math.round((1200 + 2700 + 100 + 100) / 4));
    expect(grid.byCategory[1]).toMatchObject({ label: "Feb", hosting: 2000, database: 500 });
  });

  it("spreads yearly items in run-rate mode and has no average for a future year", () => {
    const grid = buildYearGrid({
      items: [y],
      entries,
      year: 2026,
      runRate: true,
      currentMonth: "2025-12",
      monthLabel: monthShortLabel,
    });
    expect(grid.rows[0]?.cells.slice(0, 6)).toEqual([200, 200, 100, 100, 100, 100]);
    expect(grid.averageImr).toBeNull();
  });

  it("is empty without entries or active items", () => {
    const grid = buildYearGrid({
      items: [{ ...a, active: false }],
      entries: [],
      year: 2026,
      runRate: false,
      currentMonth: "2026-04",
      monthLabel: monthShortLabel,
    });
    expect(grid.rows).toEqual([]);
    expect(grid.highest).toBeNull();
    expect(grid.yearTotal).toBe(0);
  });
});

describe("copyLastMonthPlan (COST-5)", () => {
  it("copies missing monthly / usage entries as estimates; keeps no-charge; skips the rest", () => {
    const hosting = fakeItem({ name: "Hosting" });
    const free = fakeItem({ name: "Free tier", billingCycle: "usage" });
    const filled = fakeItem({ name: "Filled" });
    const yearly = fakeItem({ name: "Yearly", billingCycle: "yearly" });
    const archived = fakeItem({ name: "Archived", active: false });
    const usd = fakeItem({ name: "USD", currency: "USD" });
    const entries = [
      fakeEntry(hosting, "2026-09", 1000, "actual"),
      fakeEntry(free, "2026-09", 0, "no_charge"),
      fakeEntry(filled, "2026-09", 1000),
      fakeEntry(filled, "2026-10", 1500),
      fakeEntry(yearly, "2026-09", 9000),
      fakeEntry(archived, "2026-09", 700),
      fakeEntry(usd, "2026-09", 166500, "actual", {
        amountMinor: 2000,
        currency: "USD",
        fxRate: "83.250000",
      }),
    ];
    const plan = copyLastMonthPlan(
      [hosting, free, filled, yearly, archived, usd],
      entries,
      "2026-10",
    );
    expect(plan).toEqual([
      expect.objectContaining({ itemId: hosting.id, amountMinor: 1000, kind: "estimate" }),
      expect.objectContaining({ itemId: free.id, amountMinor: 0, kind: "no_charge" }),
      {
        itemId: usd.id,
        amountMinor: 2000,
        currency: "USD",
        fxRate: "83.250000",
        baseAmountMinor: 166500,
        kind: "estimate",
      },
    ]);
  });
});

function percent(current: number, previous: number) {
  return Math.round(((current - previous) * 1000) / previous) / 10;
}
