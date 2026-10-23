import { MessageSquarePlus } from "lucide-react";

import { CommentAnchor, requestComment, selectionQuote } from "../comment-anchor-mark";
import { COMMENT_SHORTCUT_LABEL } from "../comment-anchor-events";

import { type EditorFeature } from "./types";

/**
 * DOC-13 inline comments: the `commentAnchor` mark, its floating "Comment" button and
 * ⌘/Ctrl+Alt+M, plus a toolbar button (the toolbar is keyboard-navigable, so commenting
 * never needs a pointer). Doc editors only; the doc page's comments panel accepts the
 * request (see `comment-anchor-events.ts`).
 */
export const commentAnchorFeature: EditorFeature = {
  name: "commentAnchor",
  variants: ["doc"],
  extensions: () => [CommentAnchor],
  toolbarGroups: [
    [
      {
        label: `Comment on selection (${COMMENT_SHORTCUT_LABEL})`,
        icon: MessageSquarePlus,
        isActive: () => false,
        isDisabled: (editor) => selectionQuote(editor.state) === "",
        run: (editor) => {
          requestComment(editor);
        },
      },
    ],
  ],
};
