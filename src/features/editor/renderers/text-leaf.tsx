import { TEXT_LEAF_ATTRIBUTE, TEXT_LEAF_MARK, textLeafIndex } from "@/lib/docs/anchor-marks";

import { type MarkRenderers } from "./types";

/**
 * The docs read mode's view-only leaf tag (`tagTextLeaves`): a span with the text node's
 * index, so a selection in the read-only doc maps back to the stored JSON for an inline
 * comment (DOC-13 from read mode). Never stored; a malformed index renders the text alone.
 */
export const textLeafMarkRenderers: MarkRenderers = {
  [TEXT_LEAF_MARK]: ({ mark, index, children }) => {
    const leaf = textLeafIndex(mark);
    if (leaf === null) return children;
    return (
      <span key={index} {...{ [TEXT_LEAF_ATTRIBUTE]: leaf }}>
        {children}
      </span>
    );
  },
};
