import { describe, expect, it } from "vitest";

import { treeItem } from "@/test/doc-fixtures";

import { treeMatches } from "./doc-tree";
import { clampWidth, PAGES_WIDTH, parsePreference } from "./pages-nav";

describe("pages preference (pin and width per browser)", () => {
  it("reads what was stored and falls back to unpinned, 240 px", () => {
    expect(parsePreference(null)).toEqual({ pinned: false, width: 240 });
    expect(parsePreference("not json")).toEqual({ pinned: false, width: 240 });
    expect(parsePreference('{"pinned":true,"width":300}')).toEqual({ pinned: true, width: 300 });
    expect(parsePreference('{"pinned":"yes","width":9999}')).toEqual({
      pinned: false,
      width: PAGES_WIDTH.max,
    });
  });

  it("clamps the width", () => {
    expect(clampWidth(10)).toBe(PAGES_WIDTH.min);
    expect(clampWidth(Number.NaN)).toBe(PAGES_WIDTH.default);
    expect(clampWidth(250.6)).toBe(251);
  });
});

describe("treeMatches (search-as-you-type)", () => {
  const docs = [
    treeItem("a", "Handbook"),
    treeItem("b", "Runbook: deploys", "a"),
    treeItem("c", "Architecture"),
  ];

  it("keeps every matching page and its ancestors; all words must match", () => {
    expect(treeMatches(docs, "")).toBeNull();
    expect([...(treeMatches(docs, "DEPLOY") ?? [])].sort()).toEqual(["a", "b"]);
    expect([...(treeMatches(docs, "run arch") ?? [])]).toEqual([]);
  });
});
