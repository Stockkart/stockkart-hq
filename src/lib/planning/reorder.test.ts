import { describe, expect, it } from "vitest";

import { anchorInList, applyMove, availableMoves, dropOnto, moveBy, moveToIndex } from "./reorder";

const ids = ["a", "b", "c", "d"];

describe("reorder maths (BLG-1, MY-2)", () => {
  it.each([
    ["top", "c", ["c", "a", "b", "d"], null],
    ["up", "c", ["a", "c", "b", "d"], "a"],
    ["up", "b", ["b", "a", "c", "d"], null],
    ["down", "b", ["a", "c", "b", "d"], "c"],
    ["bottom", "a", ["b", "c", "d", "a"], "d"],
  ] as const)("move %s %s", (kind, id, order, afterId) => {
    expect(moveBy(ids, id, kind)).toEqual({ order, afterId });
  });

  it("returns null when nothing moves", () => {
    expect(moveBy(ids, "a", "up")).toBeNull();
    expect(moveBy(ids, "a", "top")).toBeNull();
    expect(moveBy(ids, "d", "down")).toBeNull();
    expect(moveBy(ids, "x", "top")).toBeNull();
    expect(dropOnto(ids, "b", "b")).toBeNull();
  });

  it("drops onto another row's position in either direction", () => {
    expect(dropOnto(ids, "a", "c")).toEqual({ order: ["b", "c", "a", "d"], afterId: "c" });
    expect(dropOnto(ids, "d", "b")).toEqual({ order: ["a", "d", "b", "c"], afterId: "a" });
    expect(dropOnto(ids, "d", "a")).toEqual({ order: ["d", "a", "b", "c"], afterId: null });
  });

  it("clamps indexes", () => {
    expect(moveToIndex(ids, "a", 99)).toEqual({ order: ["b", "c", "d", "a"], afterId: "d" });
  });

  it("offers only moves that do something", () => {
    expect(availableMoves(0, 3)).toEqual({ top: false, up: false, down: true, bottom: true });
    expect(availableMoves(2, 3)).toEqual({ top: true, up: true, down: false, bottom: false });
    expect(availableMoves(0, 1)).toEqual({ top: false, up: false, down: false, bottom: false });
  });

  it("applies a move optimistically to the full list", () => {
    const list = ids.map((id) => ({ id }));
    const order = (afterId: string | null, id = "c") =>
      applyMove(list, id, afterId).map((item) => item.id);
    expect(order(null)).toEqual(["c", "a", "b", "d"]);
    expect(order("a")).toEqual(["a", "c", "b", "d"]);
    expect(order("d")).toEqual(["a", "b", "d", "c"]);
    expect(order("missing")).toEqual(ids);
    expect(order(null, "missing")).toEqual(ids);
  });
});

describe("anchorInList (grouped backlog)", () => {
  // Full rank order a1 b1 a2 b2; section "b" is [b1, b2].
  const full = ["a1", "b1", "a2", "b2"];

  it("moves to the top of a section without leaving it", () => {
    const reorder = moveBy(["b1", "b2"], "b2", "top");
    // Right after a1 (before b1), not above every section.
    expect(reorder && anchorInList(full, reorder, "b2")).toBe("a1");
  });

  it("uses the very top when the section starts the list", () => {
    const reorder = moveBy(["a1", "a2"], "a2", "top");
    expect(reorder && anchorInList(full, reorder, "a2")).toBeNull();
  });

  it("keeps an explicit predecessor", () => {
    const reorder = moveBy(["b1", "b2"], "b1", "down");
    expect(reorder && anchorInList(full, reorder, "b1")).toBe("b2");
  });
});
