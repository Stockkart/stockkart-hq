import { describe, expect, it } from "vitest";

import { DOC_COMMENT_ANCHOR_ID_PATTERN } from "@/lib/docs/constants";
import { extractPlainText, type RichTextDoc } from "@/lib/rich-text";

import {
  anchorIdsInOrder,
  anchorQuote,
  ANCHOR_ID_LENGTH,
  COMMENT_ANCHOR_MARK,
  isAnchorId,
  markAnchorId,
  newAnchorId,
} from "./anchors";

const anchored = (text: string, ...ids: string[]) => ({
  type: "text",
  text,
  marks: ids.map((anchorId) => ({ type: COMMENT_ANCHOR_MARK, attrs: { anchorId } })),
});

const doc: RichTextDoc = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Intro " }, anchored("second", "bbb")] },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [anchored("first?", "aaa", "ccc")] }],
        },
      ],
    },
    { type: "paragraph", content: [anchored("again", "bbb"), anchored("bad", "no spaces!")] },
  ],
};

describe("comment anchors (DOC-13)", () => {
  it("makes random 12-character ids that match the DB CHECK", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newAnchorId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toHaveLength(ANCHOR_ID_LENGTH);
      expect(DOC_COMMENT_ANCHOR_ID_PATTERN.test(id)).toBe(true);
      expect(isAnchorId(id)).toBe(true);
    }
  });

  it.each([
    ["", false],
    ["a".repeat(65), false],
    ["a b", false],
    ['x"]', false],
    ["A-z_9", true],
  ])("validates the anchor id %j", (value, ok) => {
    expect(isAnchorId(value)).toBe(ok);
  });

  it("quotes the selection collapsed and cut to 500 characters", () => {
    expect(anchorQuote("  two\n\n words  ")).toBe("two words");
    expect(anchorQuote("é".repeat(600))).toHaveLength(500);
    expect(anchorQuote(" \n ")).toBe("");
  });

  it("lists anchor ids in document order, once each, ignoring malformed ids", () => {
    expect(anchorIdsInOrder(doc)).toEqual(["bbb", "aaa", "ccc"]);
    expect(anchorIdsInOrder(null)).toEqual([]);
    expect(markAnchorId({ type: "bold" })).toBeNull();
    expect(markAnchorId({ type: COMMENT_ANCHOR_MARK, attrs: { anchorId: 3 } })).toBeNull();
  });

  it("detects orphans: an anchor whose text is deleted is no longer listed", () => {
    const edited: RichTextDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [anchored("again", "bbb")] }],
    };
    expect(anchorIdsInOrder(edited)).toEqual(["bbb"]);
    expect(anchorIdsInOrder(edited)).not.toContain("aaa");
  });

  it("leaves plain text unchanged: the plain-text rules ignore the mark", () => {
    expect(extractPlainText(doc)).toBe("Intro second\nfirst?\nagainbad");
  });
});
