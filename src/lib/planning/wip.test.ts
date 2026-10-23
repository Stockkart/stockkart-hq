import { describe, expect, it } from "vitest";

import { parseWipLimitText } from "@/lib/settings/wip-limit";

import { isFull, wipState } from "./wip";

describe("WIP limits (BRD-5)", () => {
  it("shows the count against the limit, over only past it", () => {
    expect(wipState(3, 4)).toEqual({
      label: "3 / 4",
      description: "3 issues, WIP limit 4",
      over: false,
    });
    expect(wipState(4, 4).over).toBe(false);
    expect(wipState(5, 4)).toMatchObject({ label: "5 / 4", over: true });
  });

  it("shows just the count without a limit, and is never over", () => {
    expect(wipState(1, null)).toEqual({ label: "1", description: "1 issue", over: false });
    expect(wipState(40, undefined).over).toBe(false);
  });

  it("calls a column full (warn on the next card) at the limit", () => {
    expect(isFull(3, 4)).toBe(false);
    expect(isFull(4, 4)).toBe(true);
    expect(isFull(9, null)).toBe(false);
  });
});

describe("WIP limit field (settings)", () => {
  it("takes 1–999, and empty for none", () => {
    expect(parseWipLimitText("")).toEqual({ ok: true, value: null });
    expect(parseWipLimitText("  ")).toEqual({ ok: true, value: null });
    expect(parseWipLimitText("1")).toEqual({ ok: true, value: 1 });
    expect(parseWipLimitText(" 999 ")).toEqual({ ok: true, value: 999 });
  });

  it.each([
    ["0", "At least 1"],
    ["1000", "At most 999"],
    ["2.5", "Enter a whole number"],
    ["-3", "Enter a whole number"],
    ["four", "Enter a whole number"],
  ])("refuses %s (%s)", (text, error) => {
    expect(parseWipLimitText(text)).toEqual({ ok: false, error });
  });
});
