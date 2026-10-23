import { describe, expect, it } from "vitest";

import { DUE_TOLERANCE_MS, isDigestDue, periodStartFor } from "./due";

const HOUR = 60 * 60 * 1000;
// 2026-10-19 is a Monday; 2026-10-20 a Tuesday.
const monday = new Date("2026-10-19T01:30:00Z");
const tuesday = new Date("2026-10-20T01:30:00Z");
const ago = (from: Date, ms: number) => new Date(from.getTime() - ms);

describe("digest due logic (NTF-2)", () => {
  it("daily: due once the last digest is a day old, allowing for cron jitter", () => {
    expect(isDigestDue({ frequency: "daily", lastDigestAt: null }, tuesday)).toBe(true);
    expect(
      isDigestDue({ frequency: "daily", lastDigestAt: ago(tuesday, 24 * HOUR) }, tuesday),
    ).toBe(true);
    // Yesterday's run at 01:59, today's at 01:01: still due.
    expect(
      isDigestDue({ frequency: "daily", lastDigestAt: ago(tuesday, 23 * HOUR) }, tuesday),
    ).toBe(true);
    expect(
      isDigestDue(
        { frequency: "daily", lastDigestAt: ago(tuesday, 24 * HOUR - DUE_TOLERANCE_MS - 1) },
        tuesday,
      ),
    ).toBe(false);
    expect(isDigestDue({ frequency: "daily", lastDigestAt: ago(tuesday, HOUR) }, tuesday)).toBe(
      false,
    );
  });

  it("weekly: only on Mondays (UTC), a week after the last one", () => {
    const week = 7 * 24 * HOUR;
    expect(isDigestDue({ frequency: "weekly", lastDigestAt: null }, tuesday)).toBe(false);
    expect(isDigestDue({ frequency: "weekly", lastDigestAt: null }, monday)).toBe(true);
    expect(isDigestDue({ frequency: "weekly", lastDigestAt: ago(monday, week) }, monday)).toBe(
      true,
    );
    expect(isDigestDue({ frequency: "weekly", lastDigestAt: ago(tuesday, week) }, tuesday)).toBe(
      false,
    );
    expect(
      isDigestDue({ frequency: "weekly", lastDigestAt: ago(monday, 3 * 24 * HOUR) }, monday),
    ).toBe(false);
    // Sunday 23:30 UTC is not Monday, whatever the local time zone.
    expect(
      isDigestDue({ frequency: "weekly", lastDigestAt: null }, new Date("2026-10-18T23:30:00Z")),
    ).toBe(false);
  });

  it("starts the period at the last digest, or deterministically for the whole day", () => {
    const last = ago(tuesday, 30 * HOUR);
    expect(periodStartFor({ frequency: "daily", lastDigestAt: last }, tuesday)).toEqual(last);
    const first = periodStartFor({ frequency: "daily", lastDigestAt: null }, tuesday);
    expect(first).toEqual(new Date("2026-10-19T00:00:00Z"));
    // Two runs on the same day claim the same period.
    expect(
      periodStartFor({ frequency: "daily", lastDigestAt: null }, new Date("2026-10-20T23:59:00Z")),
    ).toEqual(first);
    expect(periodStartFor({ frequency: "weekly", lastDigestAt: null }, monday)).toEqual(
      new Date("2026-10-12T00:00:00Z"),
    );
  });
});
