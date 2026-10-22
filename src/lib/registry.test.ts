import { describe, expect, it } from "vitest";

import { mergeRegistries } from "./registry";

describe("mergeRegistries", () => {
  it("merges in order", () => {
    expect([...mergeRegistries("Test", [{ a: 1 }, { b: 2, c: 3 }]).entries()]).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("throws when a key is registered twice", () => {
    expect(() => mergeRegistries("Renderers", [{ mention: 1 }, { mention: 2 }])).toThrow(
      'Renderers: "mention" is registered twice',
    );
  });
});
