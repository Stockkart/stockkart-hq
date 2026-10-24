import { describe, expect, it } from "vitest";

import { MAX_AMOUNT_MINOR } from "./constants";
import {
  amortiseYearly,
  convertToBase,
  defaultRate,
  formatMoney,
  minorToDecimal,
  minorToInput,
  parseFxRate,
  parseMoney,
  percentChange,
} from "./money";

describe("parseMoney (COST-3)", () => {
  it.each([
    ["0", "INR", 0],
    ["12", "USD", 1200],
    ["12.5", "USD", 1250],
    ["12.05", "USD", 1205],
    [".5", "USD", 50],
    ["1,234.56", "USD", 123456],
    ["₹ 1,23,456.78", "INR", 12345678],
    ["$19.99", "USD", 1999],
    ["USD 20", "USD", 2000],
    ["inr 5", "INR", 500],
    ["  7.  ", "INR", 700],
  ] as const)("%s (%s) → %i minor units", (text, currency, minor) => {
    expect(parseMoney(text, currency)).toEqual({ ok: true, value: minor });
  });

  it("has no float drift (0.1 + 0.2 style values stay exact)", () => {
    expect(parseMoney("0.29", "USD")).toEqual({ ok: true, value: 29 });
    expect(parseMoney("1.15", "USD")).toEqual({ ok: true, value: 115 });
    expect(parseMoney("4.35", "INR")).toEqual({ ok: true, value: 435 });
    expect(parseMoney("9999999999.99", "INR")).toEqual({ ok: true, value: MAX_AMOUNT_MINOR });
  });

  it.each(["", "abc", "-5", "1.234", "1e3", "12..3", "$5", "₹"])("refuses %j for INR", (text) => {
    expect(parseMoney(text, "INR").ok).toBe(false);
  });

  it("refuses anything over the maximum", () => {
    expect(parseMoney("10000000000", "INR")).toMatchObject({ ok: false });
    expect(parseMoney("99999999999999999999", "USD")).toMatchObject({ ok: false });
  });
});

describe("formatting", () => {
  it("formats minor units with the currency's grouping", () => {
    expect(formatMoney(12345678, "INR")).toBe("₹1,23,456.78");
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatMoney(5, "USD")).toBe("$0.05");
    expect(formatMoney(0, "INR")).toBe("₹0.00");
  });

  it("formats the maximum exactly (no float rounding)", () => {
    expect(formatMoney(MAX_AMOUNT_MINOR, "INR")).toBe("₹9,99,99,99,999.99");
    expect(formatMoney(MAX_AMOUNT_MINOR, "USD")).toBe("$9,999,999,999.99");
    expect(minorToDecimal(MAX_AMOUNT_MINOR)).toBe("9999999999.99");
  });

  it("writes input text without trailing .00", () => {
    expect(minorToInput(1200)).toBe("12");
    expect(minorToInput(1250)).toBe("12.50");
    expect(minorToInput(7)).toBe("0.07");
  });

  it("refuses non-integer or negative minor units", () => {
    expect(() => minorToDecimal(1.5)).toThrow(RangeError);
    expect(() => minorToDecimal(-1)).toThrow(RangeError);
  });
});

describe("FX (COST-3, half-up rounding)", () => {
  it("normalises rates to numeric(12,6) text", () => {
    expect(parseFxRate("83.25")).toEqual({ ok: true, value: "83.250000" });
    expect(parseFxRate("0.012")).toEqual({ ok: true, value: "0.012000" });
    expect(parseFxRate("999999.999999")).toEqual({ ok: true, value: "999999.999999" });
  });

  it.each(["0", "0.000000", "-1", "1.1234567", "1234567", "abc", ""])("refuses %j", (text) => {
    expect(parseFxRate(text).ok).toBe(false);
  });

  it("converts minor × rate exactly and rounds half-up", () => {
    expect(convertToBase(2000, "83.250000")).toBe(166500); // $20 → ₹1,665.00
    expect(convertToBase(1, "0.5")).toBe(1); // 0.5 → 1 (half-up)
    expect(convertToBase(3, "0.5")).toBe(2); // 1.5 → 2 (half-up, not half-even)
    expect(convertToBase(5, "0.5")).toBe(3); // 2.5 → 3 (half-even would give 2)
    expect(convertToBase(1, "0.499999")).toBe(0);
    expect(convertToBase(1999, "83.333333")).toBe(166583); // 166583.332667
    expect(convertToBase(0, "83.25")).toBe(0);
  });

  it("returns null when the converted amount is over the maximum", () => {
    expect(convertToBase(MAX_AMOUNT_MINOR, "83.25")).toBeNull();
    expect(convertToBase(MAX_AMOUNT_MINOR, "1")).toBe(MAX_AMOUNT_MINOR);
  });

  it("derives the default rate both ways from 1 USD = x INR", () => {
    expect(defaultRate("USD", "INR", "83.250000")).toBe("83.250000");
    expect(defaultRate("INR", "USD", "80.000000")).toBe("0.012500");
    expect(defaultRate("INR", "USD", "83.250000")).toBe("0.012012"); // 0.0120120…
    expect(defaultRate("USD", "USD", "83.25")).toBeNull();
    expect(defaultRate("USD", "INR", null)).toBeNull();
    // 1 / 0.000001 = 1,000,000 does not fit numeric(12,6): no pre-fill.
    expect(defaultRate("INR", "USD", "0.000001")).toBeNull();
    expect(defaultRate("INR", "USD", "0.000002")).toBe("500000.000000");
  });
});

describe("run-rate and change (COST-4)", () => {
  it("spreads a yearly amount over 12 months, half-up", () => {
    expect(amortiseYearly(120000)).toBe(10000);
    expect(amortiseYearly(100)).toBe(8); // 8.33 → 8
    expect(amortiseYearly(102)).toBe(9); // 8.5 → 9 (half-up)
    expect(amortiseYearly(6)).toBe(1); // 0.5 → 1
    expect(amortiseYearly(5)).toBe(0); // 0.416 → 0
    expect(amortiseYearly(MAX_AMOUNT_MINOR)).toBe(83333333333);
  });

  it("gives the percent change vs last month, or null without a base", () => {
    expect(percentChange(1100, 1000)).toBe(10);
    expect(percentChange(900, 1000)).toBe(-10);
    expect(percentChange(1000, 3000)).toBe(-66.7);
    expect(percentChange(1000, 1000)).toBe(0);
    expect(percentChange(1000, 0)).toBeNull();
    expect(percentChange(1000, null)).toBeNull();
  });
});
