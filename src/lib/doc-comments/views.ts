import { type RichTextDoc } from "@/lib/rich-text";

/** Read models of the doc comments panel (DOC-11, DOC-13). Isomorphic and pure. */

export interface DocCommentView {
  id: string;
  authorId: string | null;
  authorName: string | null;
  /** Null for a deleted top comment that is still shown because it has live replies. */
  body: RichTextDoc | null;
  createdAt: Date;
  editedAt: Date | null;
}

export interface DocThreadView extends DocCommentView {
  /** Null for a page-level comment (DOC-11). */
  anchorId: string | null;
  /** The quoted selection, kept so an orphaned thread still shows what it was about. */
  anchorText: string | null;
  resolvedAt: Date | null;
  resolvedByName: string | null;
  /** Oldest first. */
  replies: DocCommentView[];
}

/** One row of `commentService.listForDoc`: a top comment or a reply. */
export interface DocCommentRow extends DocCommentView {
  parentId: string | null;
  anchorId: string | null;
  anchorText: string | null;
  resolvedAt: Date | null;
  resolvedByName: string | null;
  deleted: boolean;
}

/**
 * Rows (oldest first) → threads (oldest first), replies under their top comment. A deleted
 * top comment stays as a placeholder (body null) while it has live replies, so nobody's
 * reply disappears with it; otherwise it is dropped. Replies whose thread is missing are
 * dropped too.
 */
export function groupThreads(rows: readonly DocCommentRow[]): DocThreadView[] {
  const replies = new Map<string, DocCommentView[]>();
  for (const row of rows) {
    if (row.parentId === null || row.deleted) continue;
    const list = replies.get(row.parentId) ?? [];
    list.push(commentOf(row));
    replies.set(row.parentId, list);
  }
  const threads: DocThreadView[] = [];
  for (const row of rows) {
    if (row.parentId !== null) continue;
    const own = replies.get(row.id) ?? [];
    if (row.deleted && own.length === 0) continue;
    threads.push({
      ...commentOf(row),
      body: row.deleted ? null : row.body,
      anchorId: row.anchorId,
      anchorText: row.anchorText,
      resolvedAt: row.resolvedAt,
      resolvedByName: row.resolvedByName,
      replies: own,
    });
  }
  return threads;
}

function commentOf(row: DocCommentRow): DocCommentView {
  return {
    id: row.id,
    authorId: row.authorId,
    authorName: row.authorName,
    body: row.body,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
  };
}

export interface ThreadSections {
  /** Open inline threads whose text is still in the doc, in document order. */
  anchored: DocThreadView[];
  /** Open inline threads whose text was deleted ("Original text removed"). */
  orphaned: DocThreadView[];
  /** Open page-level comments, oldest first. */
  page: DocThreadView[];
  /** Resolved threads of any kind, most recently resolved first. */
  resolved: DocThreadView[];
}

/**
 * Splits threads for the panel. `anchorOrder` is `anchorIdsInOrder(<live doc>)`, so a thread
 * becomes orphaned the moment its text is deleted in the editor (and anchored again on undo).
 */
export function threadSections(
  threads: readonly DocThreadView[],
  anchorOrder: readonly string[],
): ThreadSections {
  const position = new Map(anchorOrder.map((anchorId, index) => [anchorId, index]));
  const sections: ThreadSections = { anchored: [], orphaned: [], page: [], resolved: [] };
  for (const thread of threads) {
    if (thread.resolvedAt) sections.resolved.push(thread);
    else if (thread.anchorId === null) sections.page.push(thread);
    else if (position.has(thread.anchorId)) sections.anchored.push(thread);
    else sections.orphaned.push(thread);
  }
  const at = (thread: DocThreadView) => position.get(thread.anchorId ?? "") ?? 0;
  // Stable sort: threads on the same anchor keep their creation order.
  sections.anchored.sort((a, b) => at(a) - at(b));
  sections.resolved.sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0));
  return sections;
}

/** Whether a thread's anchor is gone from the doc (shown with its stored quote). */
export function isOrphaned(thread: DocThreadView, anchorOrder: readonly string[]): boolean {
  return thread.anchorId !== null && !anchorOrder.includes(thread.anchorId);
}
