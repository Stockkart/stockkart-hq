import { COMMENT_ANCHOR_MARK, markAnchorId } from "@/lib/doc-comments/anchors";

import { COMMENT_ANCHOR_ATTRIBUTE } from "../comment-anchor-events";

import { type MarkRenderers } from "./types";

/**
 * DOC-13 anchors in the read-only view: the same `<span data-comment-anchor>` the editor
 * renders, unstyled (the comments panel highlights open threads). A malformed id renders
 * the text alone.
 */
export const commentAnchorMarkRenderers: MarkRenderers = {
  [COMMENT_ANCHOR_MARK]: ({ mark, index, children }) => {
    const anchorId = markAnchorId(mark);
    if (!anchorId) return children;
    return (
      <span key={index} className="comment-anchor" {...{ [COMMENT_ANCHOR_ATTRIBUTE]: anchorId }}>
        {children}
      </span>
    );
  },
};
