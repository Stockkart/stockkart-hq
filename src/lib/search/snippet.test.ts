import { describe, expect, it } from "vitest";

import {
  HIGHLIGHT_END as E,
  HIGHLIGHT_START as S,
  parseHighlighted,
  snippetParts,
} from "./snippet";

describe("search snippets (SRCH-2)", () => {
  it("turns ts_headline markers into text plus ranges", () => {
    const snippet = parseHighlighted(`fix the ${S}outbox${E} and ${S}retry${E}`);
    expect(snippet).toEqual({
      text: "fix the outbox and retry",
      highlights: [
        [8, 14],
        [19, 24],
      ],
    });
    expect(snippetParts(snippet)).toEqual([
      { text: "fix the ", highlight: false },
      { text: "outbox", highlight: true },
      { text: " and ", highlight: false },
      { text: "retry", highlight: true },
    ]);
  });

  it("keeps markup as literal text", () => {
    const snippet = parseHighlighted(`<img src=x onerror=alert(1)> ${S}x${E}`);
    expect(snippet.text).toBe("<img src=x onerror=alert(1)> x");
  });

  it("tolerates stray, nested and unterminated markers", () => {
    expect(parseHighlighted(`${E}a${S}${S}b${E}${E}c${S}d`)).toEqual({
      text: "abcd",
      highlights: [
        [1, 2],
        [3, 4],
      ],
    });
    expect(parseHighlighted(`${S}${E}empty`).highlights).toEqual([]);
  });

  it("skips out-of-range or overlapping ranges when rendering", () => {
    expect(
      snippetParts({
        text: "abcdef",
        highlights: [
          [1, 3],
          [2, 4],
          [5, 99],
        ],
      }),
    ).toEqual([
      { text: "a", highlight: false },
      { text: "bc", highlight: true },
      { text: "def", highlight: false },
    ]);
  });
});
