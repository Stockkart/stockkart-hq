import { describe, expect, it } from "vitest";

import {
  canTransition,
  formatDuration,
  incidentPath,
  parseIncidentKey,
  timeOrderError,
  timesAfterTransition,
} from "./rules";

const t = (iso: string) => new Date(iso);
const NOW = t("2026-10-20T12:00:00Z");

describe("incident transitions (INC-1)", () => {
  it("allows the forward path, skipping mitigation, and reopening", () => {
    expect(canTransition("investigating", "mitigated")).toBe(true);
    expect(canTransition("mitigated", "resolved")).toBe(true);
    expect(canTransition("investigating", "resolved")).toBe(true);
    expect(canTransition("resolved", "investigating")).toBe(true);
  });

  it("refuses everything else", () => {
    expect(canTransition("mitigated", "investigating")).toBe(false);
    expect(canTransition("resolved", "mitigated")).toBe(false);
    expect(canTransition("investigating", "investigating")).toBe(false);
  });

  it("sets and clears the timestamps like the CHECKs require", () => {
    const start = { startedAt: t("2026-10-20T10:00:00Z"), mitigatedAt: null, resolvedAt: null };
    const mitigated = timesAfterTransition(start, "mitigated", t("2026-10-20T10:30:00Z"));
    expect(mitigated.mitigatedAt).toEqual(t("2026-10-20T10:30:00Z"));
    const resolved = timesAfterTransition(mitigated, "resolved", t("2026-10-20T11:00:00Z"));
    expect(resolved.resolvedAt).toEqual(t("2026-10-20T11:00:00Z"));
    const reopened = timesAfterTransition(resolved, "investigating", NOW);
    expect(reopened).toEqual({ ...resolved, resolvedAt: null });
  });
});

describe("timeOrderError", () => {
  const startedAt = t("2026-10-20T10:00:00Z");

  it("accepts ordered times", () => {
    expect(
      timeOrderError(
        "resolved",
        {
          startedAt,
          mitigatedAt: t("2026-10-20T10:10:00Z"),
          resolvedAt: t("2026-10-20T11:00:00Z"),
        },
        NOW,
      ),
    ).toBeNull();
    expect(
      timeOrderError("investigating", { startedAt, mitigatedAt: null, resolvedAt: null }, NOW),
    ).toBeNull();
  });

  it.each([
    ["mitigated before start", "mitigated", t("2026-10-20T09:00:00Z"), null],
    ["resolved before mitigated", "resolved", t("2026-10-20T10:30:00Z"), t("2026-10-20T10:20:00Z")],
    ["resolved before start", "resolved", null, t("2026-10-20T09:59:00Z")],
    ["mitigated without a time", "mitigated", null, null],
    ["resolved without a time", "resolved", null, null],
    ["a resolution time while open", "investigating", null, t("2026-10-20T11:00:00Z")],
    ["a future time", "resolved", null, t("2026-10-21T00:00:00Z")],
  ] as const)("refuses %s", (_, status, mitigatedAt, resolvedAt) => {
    expect(timeOrderError(status, { startedAt, mitigatedAt, resolvedAt }, NOW)).not.toBeNull();
  });
});

describe("helpers", () => {
  it("formats durations", () => {
    expect(formatDuration(30_000)).toBe("< 1m");
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(135 * 60_000)).toBe("2h 15m");
    expect(formatDuration((3 * 24 + 4) * 3_600_000)).toBe("3d 4h");
  });

  it("parses incident keys and builds paths", () => {
    expect(parseIncidentKey("inc-12")).toBe(12);
    expect(parseIncidentKey("INC-0")).toBeNull();
    expect(parseIncidentKey("STK-12")).toBeNull();
    expect(incidentPath("STK", 12)).toBe("/STK/incidents/INC-12");
  });
});
