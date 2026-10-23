import { describe, expect, it } from "vitest";

import { fakeEntry, fakeItem } from "@/test/cost-fixtures";

import { monthCsv, yearCsv } from "./csv";

describe("costs CSV export (COST-5)", () => {
  const evil = fakeItem({ name: '=HYPERLINK("http://x")', vendor: "Acme, Inc." });
  const plain = fakeItem({ name: "Vercel", currency: "USD" });
  const entries = [
    fakeEntry(evil, "2026-10", 123456, "actual", { notes: "+1 line\nbreak" }),
    fakeEntry(plain, "2026-10", 166500, "estimate", {
      amountMinor: 2000,
      currency: "USD",
      fxRate: "83.250000",
    }),
  ];

  it("escapes formulas, commas, quotes and line breaks (CSV injection)", () => {
    const csv = monthCsv({ items: [evil, plain], entries, month: "2026-10", baseCurrency: "INR" });
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "Month,Item,Vendor,Category,Cycle,Service,Currency,Amount,Rate to INR,Amount (INR),Kind,Notes",
    );
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")","Acme, Inc."`);
    expect(csv).toContain(`"'+1 line\nbreak"`);
    expect(csv).toContain("2026-10,Vercel,,Hosting,Monthly,,USD,20.00,83.250000,1665.00,Estimate,");
    expect(csv).toContain("2026-10,Cash out,,,,,,,,2899.56");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("writes the year grid with exact decimals", () => {
    const csv = yearCsv({
      items: [evil, plain],
      entries,
      year: 2026,
      baseCurrency: "INR",
      currentMonth: "2026-12",
    });
    const [header, , , total] = csv.split("\r\n");
    expect(header?.startsWith("Item (INR),Category,Jan 2026,Feb 2026")).toBe(true);
    expect(header?.endsWith("Dec 2026,Total")).toBe(true);
    expect(total).toBe(`Total,,${"0.00,".repeat(9)}2899.56,0.00,0.00,2899.56`);
  });
});
