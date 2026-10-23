import { describe, expect, it } from "vitest";

import { anchorIdsInOrder, COMMENT_ANCHOR_MARK } from "@/lib/doc-comments/anchors";
import { type RichTextDoc, type RichTextNode } from "@/lib/rich-text";

import {
  addAnchorMark,
  anchorTexts,
  reanchor,
  removeAnchorMark,
  restoredContent,
  TEXT_LEAF_MARK,
  tagTextLeaves,
  textLeafIndex,
} from "./anchor-marks";

const anchor = (anchorId: string) => ({ type: COMMENT_ANCHOR_MARK, attrs: { anchorId } });
const bold = { type: "bold" };

// Leaves (pre-order): 0 "Hello ", 1 "bold" (bold), 2 "x = 1" (code block), 3 "code" (inline
// code), 4 "Second line".
const doc: RichTextDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "bold", marks: [bold] },
      ],
    },
    { type: "codeBlock", content: [{ type: "text", text: "x = 1" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "code", marks: [{ type: "code" }] },
        { type: "text", text: "Second line" },
      ],
    },
  ],
};

const texts = (node: RichTextNode): RichTextNode[] =>
  node.type === "text" ? [node] : (node.content ?? []).flatMap(texts);

describe("tagTextLeaves (read mode)", () => {
  it("tags markable leaves with their pre-order index, outermost, and skips code", () => {
    const tagged = texts(tagTextLeaves(doc));
    const leaves = tagged.map((node) => {
      const tag = node.marks?.find((mark) => mark.type === TEXT_LEAF_MARK);
      return tag ? textLeafIndex(tag) : null;
    });
    expect(leaves).toEqual([0, 1, null, null, 4]);
    // The tag is the last (outermost) mark, after the bold.
    expect(tagged[1]?.marks?.map((mark) => mark.type)).toEqual(["bold", TEXT_LEAF_MARK]);
    // The source is not changed.
    expect(JSON.stringify(doc)).not.toContain(TEXT_LEAF_MARK);
  });

  it("refuses malformed leaf indices", () => {
    expect(textLeafIndex({ type: TEXT_LEAF_MARK, attrs: { leaf: -1 } })).toBeNull();
    expect(textLeafIndex({ type: TEXT_LEAF_MARK, attrs: { leaf: "1" } })).toBeNull();
    expect(textLeafIndex({ type: "bold" })).toBeNull();
  });
});

describe("addAnchorMark / removeAnchorMark", () => {
  it("splits the selected text and marks it, across formatting", () => {
    const { doc: marked, changed } = addAnchorMark(
      doc,
      [
        { leaf: 0, from: 2, to: 6 },
        { leaf: 1, from: 0, to: 2 },
      ],
      "a1",
    );
    expect(changed).toBe(true);
    expect(texts(marked).slice(0, 4)).toEqual([
      { type: "text", text: "He" },
      { type: "text", text: "llo ", marks: [anchor("a1")] },
      { type: "text", text: "bo", marks: [bold, anchor("a1")] },
      { type: "text", text: "ld", marks: [bold] },
    ]);
    expect(anchorTexts(marked).get("a1")).toBe("llo bo");
    // Removing it leaves the same text and marks (split nodes are fine for the editor).
    const removed = removeAnchorMark(marked, "a1");
    expect(anchorIdsInOrder(removed)).toEqual([]);
    expect(
      texts(removed)
        .map((node) => node.text)
        .join(""),
    ).toBe(
      texts(doc)
        .map((node) => node.text)
        .join(""),
    );
  });

  it("never marks code, and reports when nothing was marked", () => {
    const result = addAnchorMark(
      doc,
      [
        { leaf: 2, from: 0, to: 3 },
        { leaf: 3, from: 0, to: 4 },
        { leaf: 0, from: 3, to: 3 },
      ],
      "a2",
    );
    expect(result.changed).toBe(false);
    expect(anchorIdsInOrder(result.doc)).toEqual([]);
  });

  it("clamps offsets to the text", () => {
    const { doc: marked } = addAnchorMark(doc, [{ leaf: 4, from: 7, to: 99 }], "a3");
    expect(anchorTexts(marked).get("a3")).toBe("line");
  });
});

describe("reanchor / restoredContent (DOC-10 restore keeps anchors)", () => {
  it("finds the quote across formatting within one block", () => {
    const result = reanchor(doc, "q1", "lo bo");
    expect(anchorTexts(result).get("q1")).toBe("lo bo");
    expect(reanchor(doc, "q2", "not there")).toBe(doc);
    // Never across blocks or into code.
    expect(anchorIdsInOrder(reanchor(doc, "q3", "boldx"))).toEqual([]);
    expect(anchorIdsInOrder(reanchor(doc, "q4", "x = 1"))).toEqual([]);
  });

  it("keeps threaded anchors, drops thread-less ones and re-anchors current ones", () => {
    const old = addAnchorMark(
      addAnchorMark(doc, [{ leaf: 0, from: 0, to: 5 }], "kept").doc,
      [{ leaf: 4, from: 0, to: 6 }],
      "stray",
    ).doc;
    const current: RichTextDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "line", marks: [anchor("moved")] }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "gone", marks: [anchor("orphan")] }],
        },
      ],
    };
    const restored = restoredContent(old, current, new Set(["kept", "moved", "orphan"]));
    expect(anchorIdsInOrder(restored)).toEqual(["kept", "moved"]);
    expect(anchorTexts(restored).get("moved")).toBe("line");
  });
});
