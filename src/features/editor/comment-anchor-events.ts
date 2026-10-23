/**
 * DOC-13: how the doc editor's "Comment" action (floating button, toolbar button,
 * ⌘/Ctrl+Alt+M) reaches the comments panel without the shared editor knowing about it.
 *
 * The editor dispatches a cancelable, bubbling `CustomEvent` on its DOM; a page that can
 * create inline comments (the doc page's panel) accepts it with `event.preventDefault()`.
 * Only then is the selection wrapped in the `commentAnchor` mark, so an editor without a
 * panel never leaves stray marks. `discard()` removes the mark again (composer cancelled).
 *
 * Kept free of Tiptap imports: the panel is not lazily loaded like the editor (SPEC §9.2).
 */

export const COMMENT_REQUEST_EVENT = "hq:comment-anchor-request";

export interface CommentRequestDetail {
  /** The new mark's id (`newAnchorId()`), also the future `comments.anchor_id`. */
  anchorId: string;
  /** The selected text, collapsed and cut to ≤ 500 characters (`anchorQuote`). */
  text: string;
  /** Removes this anchor's mark from the doc (the comment was not created). */
  discard: () => void;
  /** Puts the focus back into the doc editor (after the composer closes). */
  restoreFocus: () => void;
}

export type CommentRequestEvent = CustomEvent<CommentRequestDetail>;

export function isCommentRequestEvent(event: Event): event is CommentRequestEvent {
  if (!(event instanceof CustomEvent) || event.type !== COMMENT_REQUEST_EVENT) return false;
  const detail: unknown = event.detail;
  return (
    typeof detail === "object" &&
    detail !== null &&
    "anchorId" in detail &&
    typeof detail.anchorId === "string" &&
    "text" in detail &&
    typeof detail.text === "string" &&
    "discard" in detail &&
    typeof detail.discard === "function" &&
    "restoreFocus" in detail &&
    typeof detail.restoreFocus === "function"
  );
}

/** The attribute the mark renders, in the editor and the read-only view alike. */
export const COMMENT_ANCHOR_ATTRIBUTE = "data-comment-anchor";

/** ⌘/Ctrl+Alt+M (Tiptap notation), listed in the button's label. */
export const COMMENT_SHORTCUT = "Mod-Alt-m";
export const COMMENT_SHORTCUT_LABEL = "Ctrl+Alt+M or ⌘⌥M";
