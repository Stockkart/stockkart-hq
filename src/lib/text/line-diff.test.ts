import { describe, expect, it } from "vitest";

import { diffLineOps, lineDiff, splitLines } from "./line-diff";

/** LCS length by dynamic programming, to check that the Myers script is minimal. */
function lcsLength(a: readonly string[], b: readonly string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (const line of a) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j] ?? 0;
      row[j] = line === b[j - 1] ? diagonal + 1 : Math.max(above, row[j - 1] ?? 0);
      diagonal = above;
    }
  }
  return row[b.length] ?? 0;
}

function prng(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lines = (count: number, prefix = "line") =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join("\n");

describe("splitLines", () => {
  it("splits on any newline and treats a final newline as a terminator", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a")).toEqual(["a"]);
    expect(splitLines("a\n")).toEqual(["a"]);
    expect(splitLines("a\r\nb\rc\n\n")).toEqual(["a", "b", "c", ""]);
  });
});

describe("diffLineOps (Myers)", () => {
  it("rebuilds both texts and is minimal on generated inputs (400 cases)", () => {
    const random = prng(42);
    for (let run = 0; run < 400; run += 1) {
      const pick = () => ["a", "b", "c", "d", ""][Math.floor(random() * 5)] ?? "a";
      const a = Array.from({ length: Math.floor(random() * 12) }, pick);
      const b = Array.from({ length: Math.floor(random() * 12) }, pick);
      const ops = diffLineOps(a, b);
      expect(ops.filter((op) => op.kind !== "add").map((op) => op.text)).toEqual(a);
      expect(ops.filter((op) => op.kind !== "remove").map((op) => op.text)).toEqual(b);
      expect(ops.filter((op) => op.kind === "equal")).toHaveLength(lcsLength(a, b));
    }
  });

  it("falls back to remove-all/add-all past maxEdits, still correct", () => {
    const a = ["x", "1", "2", "3", "y"];
    const b = ["x", "4", "5", "6", "y"];
    expect(diffLineOps(a, b, 2)).toEqual([
      { kind: "equal", text: "x" },
      { kind: "remove", text: "1" },
      { kind: "remove", text: "2" },
      { kind: "remove", text: "3" },
      { kind: "add", text: "4" },
      { kind: "add", text: "5" },
      { kind: "add", text: "6" },
      { kind: "equal", text: "y" },
    ]);
  });

  it("handles large, mostly equal texts quickly", () => {
    const old = lines(20_000).split("\n");
    const next = [...old];
    next.splice(10_000, 1, "changed");
    const started = Date.now();
    const ops = diffLineOps(old, next);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(ops.filter((op) => op.kind !== "equal")).toEqual([
      { kind: "remove", text: "line 10001" },
      { kind: "add", text: "changed" },
    ]);
  });
});

describe("lineDiff hunks", () => {
  it("returns equal/add/remove hunks with line numbers", () => {
    expect(lineDiff("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual([
      { kind: "equal", text: "a", lines: 1, oldStart: 1, newStart: 1 },
      { kind: "remove", text: "b", lines: 1, oldStart: 2, newStart: 2 },
      { kind: "add", text: "B", lines: 1, oldStart: 3, newStart: 2 },
      { kind: "equal", text: "c", lines: 1, oldStart: 3, newStart: 3 },
      { kind: "add", text: "d", lines: 1, oldStart: 4, newStart: 4 },
    ]);
  });

  it("collapses unchanged runs to the context around each change", () => {
    const old = lines(20);
    const next = old.replace("line 10\n", "line ten\n");
    const hunks = lineDiff(old, next, { context: 2 });
    expect(
      hunks.map(({ kind, lines: count, collapsed }) => [kind, count, collapsed ?? false]),
    ).toEqual([
      ["equal", 7, true],
      ["equal", 2, false],
      ["remove", 1, false],
      ["add", 1, false],
      ["equal", 2, false],
      ["equal", 8, true],
    ]);
    expect(hunks[0]).toMatchObject({ oldStart: 1, newStart: 1, text: lines(7) });
    expect(hunks[1]).toMatchObject({ oldStart: 8, text: "line 8\nline 9" });
    expect(hunks[5]).toMatchObject({ oldStart: 13, newStart: 13 });
  });

  it("does not collapse a run that fits in the context on both sides", () => {
    const hunks = lineDiff("x\na\nb\nc\nd\ny", "X\na\nb\nc\nd\nY", { context: 2 });
    expect(hunks.filter((hunk) => hunk.collapsed)).toEqual([]);
    expect(hunks.find((hunk) => hunk.kind === "equal")?.lines).toBe(4);
  });

  it("collapses everything when nothing changed, and handles empty texts", () => {
    expect(lineDiff("a\nb", "a\nb\n")).toEqual([
      { kind: "equal", text: "a\nb", lines: 2, oldStart: 1, newStart: 1, collapsed: true },
    ]);
    expect(lineDiff("", "")).toEqual([]);
    expect(lineDiff("", "new")).toEqual([
      { kind: "add", text: "new", lines: 1, oldStart: 1, newStart: 1 },
    ]);
    expect(lineDiff("old", "")).toEqual([
      { kind: "remove", text: "old", lines: 1, oldStart: 1, newStart: 1 },
    ]);
  });
});
