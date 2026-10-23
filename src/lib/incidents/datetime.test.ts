import { describe, expect, it } from "vitest";

import { fromLocalInput, toLocalInput } from "./datetime";

describe("datetime-local helpers", () => {
  it("round-trips a local time to the minute", () => {
    const date = new Date(2026, 9, 20, 9, 5, 42);
    const value = toLocalInput(date);
    expect(value).toBe("2026-10-20T09:05");
    expect(fromLocalInput(value)).toBe(new Date(2026, 9, 20, 9, 5).toISOString());
  });

  it("refuses empty and malformed values", () => {
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("yesterday")).toBeNull();
    expect(fromLocalInput("2026-13-40T99:99")).toBeNull();
  });
});
