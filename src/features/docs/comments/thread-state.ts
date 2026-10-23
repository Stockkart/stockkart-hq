import { isAnchorId } from "@/lib/doc-comments/anchors";
import { type DocCommentView, type DocThreadView } from "@/lib/doc-comments/views";
import { type RichTextDoc } from "@/lib/rich-text";

import { COMMENT_ANCHOR_ATTRIBUTE } from "@/features/editor/comment-anchor-events";

/**
 * Pure state of the doc comments panel (DOC-11, DOC-13): the optimistic updates applied
 * while an action runs (React `useOptimistic` drops them when it ends, and the action's
 * re-render brings the server's copy), and the highlight rules for open anchors.
 */

export type ThreadUpdate =
  | { kind: "addThread"; thread: DocThreadView }
  | { kind: "addReply"; threadId: string; reply: DocCommentView }
  | { kind: "resolve"; threadId: string; resolvedAt: Date | null; resolvedByName: string | null }
  | { kind: "edit"; commentId: string; body: RichTextDoc }
  | { kind: "delete"; commentId: string };

export function applyThreadUpdate(
  threads: readonly DocThreadView[],
  update: ThreadUpdate,
): DocThreadView[] {
  switch (update.kind) {
    case "addThread":
      return [...threads, update.thread];
    case "addReply":
      return threads.map((thread) =>
        thread.id === update.threadId
          ? { ...thread, replies: [...thread.replies, update.reply] }
          : thread,
      );
    case "resolve":
      return threads.map((thread) =>
        thread.id === update.threadId
          ? { ...thread, resolvedAt: update.resolvedAt, resolvedByName: update.resolvedByName }
          : thread,
      );
    case "edit":
      return threads.map((thread) => ({
        ...(thread.id === update.commentId ? { ...thread, body: update.body } : thread),
        replies: thread.replies.map((reply) =>
          reply.id === update.commentId ? { ...reply, body: update.body } : reply,
        ),
      }));
    case "delete":
      return threads.flatMap((thread) => {
        if (thread.id === update.commentId) {
          // Same rule as the server: a top comment with replies stays as a placeholder.
          return thread.replies.length > 0 ? [{ ...thread, body: null }] : [];
        }
        return [
          { ...thread, replies: thread.replies.filter((reply) => reply.id !== update.commentId) },
        ];
      });
  }
}

/** The thread holding a comment (top or reply), e.g. for a `#comment-<id>` link. */
export function threadOfComment(
  threads: readonly DocThreadView[],
  commentId: string,
): DocThreadView | null {
  return (
    threads.find(
      (thread) => thread.id === commentId || thread.replies.some((reply) => reply.id === commentId),
    ) ?? null
  );
}

const selector = (anchorId: string) => `.rich-text [${COMMENT_ANCHOR_ATTRIBUTE}="${anchorId}"]`;

/**
 * CSS that highlights the anchors of OPEN threads only (resolved ones stay plain text):
 * a background that keeps the text's own colour (contrast stays that of the text) plus a
 * dotted underline, so the highlight never relies on colour alone. The active thread's text
 * gets a solid underline and a stronger background. Ids are re-checked against the anchor
 * pattern (`[A-Za-z0-9_-]`), so nothing from the doc can break out of the selector.
 */
export function highlightCss(
  openAnchorIds: readonly string[],
  activeAnchorId: string | null,
): string {
  const ids = [...new Set(openAnchorIds.filter(isAnchorId))];
  if (ids.length === 0) return "";
  const rules = [
    `${ids.map(selector).join(",\n")} {
  background-color: var(--comment-highlight);
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-thickness: 2px;
  text-decoration-color: var(--comment-underline);
  text-underline-offset: 3px;
  cursor: pointer;
}`,
  ];
  if (activeAnchorId && ids.includes(activeAnchorId)) {
    rules.push(`${selector(activeAnchorId)} {
  background-color: var(--comment-highlight-active);
  text-decoration-style: solid;
}`);
  }
  return rules.join("\n");
}
