import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { COMMENT_ANCHOR_MARK } from "@/lib/doc-comments/anchors";
import { type RichTextDoc } from "@/lib/rich-text";
import { PLAIN_TEXT_RULES } from "@/lib/rich-text-nodes";

import { RichTextView } from "../rich-text-view";

import { MARK_RENDERERS } from ".";

const doc = (anchorId: unknown): RichTextDoc => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "see " },
        {
          type: "text",
          text: "this part",
          marks: [{ type: "bold" }, { type: COMMENT_ANCHOR_MARK, attrs: { anchorId } }],
        },
      ],
    },
  ],
});

describe("commentAnchor in the read-only view (DOC-13)", () => {
  it("is registered once as a mark renderer, not as a plain-text node", () => {
    expect(MARK_RENDERERS.has(COMMENT_ANCHOR_MARK)).toBe(true);
    expect(PLAIN_TEXT_RULES.has(COMMENT_ANCHOR_MARK)).toBe(false);
  });

  it("wraps the text in an unstyled span with the anchor id", () => {
    const html = renderToStaticMarkup(<RichTextView doc={doc("abc_123")} projectKeys={[]} />);
    expect(html).toContain(
      '<span class="comment-anchor" data-comment-anchor="abc_123"><strong>this part</strong></span>',
    );
  });

  it.each([['x"><script>'], [42], [undefined]])("renders only the text for anchor id %j", (id) => {
    const html = renderToStaticMarkup(<RichTextView doc={doc(id)} projectKeys={[]} />);
    expect(html).not.toContain("data-comment-anchor");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<strong>this part</strong>");
  });
});
