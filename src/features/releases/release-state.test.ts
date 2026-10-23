import { describe, expect, it } from "vitest";

import { type ReleaseSummary } from "@/lib/releases/views";

import { applyReleaseChange, sortReleases } from "./release-state";

function release(id: string, overrides: Partial<ReleaseSummary> = {}): ReleaseSummary {
  return {
    id,
    name: id,
    description: null,
    releaseDate: null,
    state: "unreleased",
    releasedAt: null,
    total: { count: 0, points: 0 },
    done: { count: 0, points: 0 },
    notesDocId: null,
    ...overrides,
  };
}

const ids = (list: ReleaseSummary[]) => list.map((item) => item.id);

describe("release list order and optimistic changes (REL-1)", () => {
  it("lists unreleased by target date (none last), then released, newest first", () => {
    const list = sortReleases([
      release("old", { state: "released", releasedAt: new Date("2026-01-01") }),
      release("undated"),
      release("july", { releaseDate: "2026-07-01" }),
      release("new", { state: "released", releasedAt: new Date("2026-03-01") }),
      release("june", { releaseDate: "2026-06-01" }),
    ]);
    expect(ids(list)).toEqual(["june", "july", "undated", "new", "old"]);
  });

  it("adds, edits (re-sorting) and removes", () => {
    let list = [release("a", { releaseDate: "2026-06-01" })];
    list = applyReleaseChange(list, { kind: "add", release: release("new:b") });
    expect(ids(list)).toEqual(["a", "new:b"]);
    list = applyReleaseChange(list, {
      kind: "update",
      id: "new:b",
      fields: { name: "b", releaseDate: "2026-05-01", description: "x" },
    });
    expect(ids(list)).toEqual(["new:b", "a"]);
    expect(list[0]?.description).toBe("x");
    expect(ids(applyReleaseChange(list, { kind: "remove", id: "a" }))).toEqual(["new:b"]);
  });

  it("releases (moving the open tally to the target) and reopens", () => {
    const at = new Date("2026-06-30T12:00:00Z");
    const list = [
      release("v1", { total: { count: 5, points: 13 }, done: { count: 3, points: 8 } }),
      release("v2", { total: { count: 1, points: 2 } }),
    ];
    const released = applyReleaseChange(list, { kind: "release", id: "v1", at, moveOpenTo: "v2" });
    const v1 = released.find((item) => item.id === "v1");
    const v2 = released.find((item) => item.id === "v2");
    expect(v1).toMatchObject({ state: "released", releasedAt: at, total: { count: 3, points: 8 } });
    expect(v2?.total).toEqual({ count: 3, points: 7 });
    expect(ids(released)).toEqual(["v2", "v1"]);

    const kept = applyReleaseChange(list, { kind: "release", id: "v1", at, moveOpenTo: null });
    expect(kept.find((item) => item.id === "v1")?.total).toEqual({ count: 5, points: 13 });

    const reopened = applyReleaseChange(released, { kind: "reopen", id: "v1" });
    expect(reopened.find((item) => item.id === "v1")).toMatchObject({
      state: "unreleased",
      releasedAt: null,
    });
  });
});
