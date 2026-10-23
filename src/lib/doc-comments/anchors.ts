import { DOC_COMMENT_ANCHOR_ID_PATTERN, DOC_COMMENT_ANCHOR_TEXT_MAX } from "@/lib/docs/constants";
import { type RichTextNode } from "@/lib/rich-text";

/**
 * DOC-13 inline comment anchors. Isomorphic: the editor mark, the read-only renderer, the
 * comments panel and the server share these rules.
 *
 * An anchor is a `commentAnchor` mark with a stable random `anchorId` on the commented text
 * in the doc JSON; the comment row keeps the id and the quoted text, never offsets, so edits
 * around the text move the anchor with it. Deleting all of the marked text "orphans" the
 * thread (the panel then shows the stored quote).
 */

/** The Tiptap/ProseMirror mark type name. */
export const COMMENT_ANCHOR_MARK = "commentAnchor";

/** Length of the ids this app generates (the DB CHECK allows 1…64 of `[A-Za-z0-9_-]`). */
export const ANCHOR_ID_LENGTH = 12;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

export function isAnchorId(value: unknown): value is string {
  return typeof value === "string" && DOC_COMMENT_ANCHOR_ID_PATTERN.test(value);
}

/**
 * A random 12-character id from the 64-character URL-safe alphabet (72 bits), so ids from
 * different editors never collide in practice. Uses Web Crypto (browser and Node).
 */
export function newAnchorId(): string {
  const bytes = new Uint8Array(ANCHOR_ID_LENGTH);
  crypto.getRandomValues(bytes);
  // 256 is a multiple of 64, so `byte % 64` is uniform.
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

/** The selection as stored in `comments.anchor_text`: whitespace collapsed, ≤ 500 chars. */
export function anchorQuote(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return Array.from(collapsed).slice(0, DOC_COMMENT_ANCHOR_TEXT_MAX).join("");
}

/** The anchor id of a mark, or null when it is not a well-formed comment anchor. */
export function markAnchorId(mark: { type: string; attrs?: Record<string, unknown> }) {
  if (mark.type !== COMMENT_ANCHOR_MARK) return null;
  const id = mark.attrs?.anchorId;
  return isAnchorId(id) ? id : null;
}

/**
 * The anchor ids present in a doc, in document order (first occurrence), so threads can be
 * listed by where their text is. An id that is missing here belongs to an orphaned thread.
 * Iterative, like the rich-text limits check, so a deep document cannot overflow the stack.
 */
export function anchorIdsInOrder(doc: RichTextNode | null | undefined): string[] {
  if (!doc) return [];
  const seen = new Set<string>();
  const order: string[] = [];
  const stack: RichTextNode[] = [doc];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    for (const mark of node.marks ?? []) {
      const id = markAnchorId(mark);
      if (id && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
    const children = node.content ?? [];
    // Reversed onto the stack, so children are visited in document order.
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child) stack.push(child);
    }
  }
  return order;
}
