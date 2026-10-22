import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * SPEC §9.3 retention (7 daily + 4 weekly) as `scripts/backup-retention.sh`, which the
 * nightly backup workflow uses to decide what to delete. Runs the script with bash; no
 * network, no bucket.
 */

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/backup-retention.sh",
);

const expired = (today: string, keys: string[]): string[] =>
  execFileSync("bash", [SCRIPT, "expired", today], { input: keys.join("\n"), encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

const isWeekly = (date: string) => spawnSync("bash", [SCRIPT, "is-weekly", date]).status;

describe("backup retention (§9.3)", () => {
  it("keeps the last 7 daily copies (today and the 6 days before)", () => {
    const keys = Array.from({ length: 10 }, (_, index) => {
      const day = String(14 - index).padStart(2, "0");
      return `backups/daily/2026-03-${day}.sql.gz`;
    });
    expect(expired("2026-03-14", keys)).toEqual([
      "backups/daily/2026-03-07.sql.gz",
      "backups/daily/2026-03-06.sql.gz",
      "backups/daily/2026-03-05.sql.gz",
    ]);
  });

  it("keeps the last 4 weekly copies (28 days)", () => {
    const sundays = ["2026-03-15", "2026-03-08", "2026-03-01", "2026-02-22", "2026-02-15"];
    expect(
      expired(
        "2026-03-15",
        sundays.map((d) => `backups/weekly/${d}.sql.gz`),
      ),
    ).toEqual(["backups/weekly/2026-02-15.sql.gz"]);
  });

  it("handles month and year boundaries and leap days", () => {
    expect(
      expired("2028-03-06", ["backups/daily/2028-02-28.sql.gz", "backups/daily/2028-02-29.sql.gz"]),
    ).toEqual(["backups/daily/2028-02-28.sql.gz"]);
    expect(
      expired("2027-01-03", ["backups/daily/2026-12-27.sql.gz", "backups/daily/2026-12-28.sql.gz"]),
    ).toEqual(["backups/daily/2026-12-27.sql.gz"]);
  });

  it("never selects anything outside the two layouts", () => {
    expect(
      expired("2026-03-14", [
        "backups/stockkart-hq-2020-01-01T021700Z.sql.gz",
        "tmp/stockkart-hq-2020-01-01.sql.gz",
        "attachments/11111111-2222-4333-8444-555555555555/2020-01-01.sql.gz",
        "backups/daily/2020-01-01.sql",
        "backups/daily/2020-13-01.sql.gz",
        "backups/monthly/2020-01-01.sql.gz",
        " backups/daily/2020-01-01.sql.gz",
        "",
        "None",
      ]),
    ).toEqual([]);
  });

  it("finds Sundays for the weekly copy", () => {
    expect(isWeekly("2026-03-15")).toBe(0);
    expect(isWeekly("2026-03-14")).toBe(1);
    expect(isWeekly("not-a-date")).toBe(2);
  });

  it("refuses a bad 'today' instead of deleting by accident", () => {
    const run = spawnSync("bash", [SCRIPT, "expired", "yesterday"], {
      input: "backups/daily/2020-01-01.sql.gz",
      encoding: "utf8",
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
  });
});
