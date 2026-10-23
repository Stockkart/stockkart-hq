import { anchorIdsInOrder, COMMENT_ANCHOR_MARK, markAnchorId } from "@/lib/doc-comments/anchors";
import { type RichTextMark, type RichTextNode } from "@/lib/rich-text";

/**
 * DOC-13 comment anchors edited as plain JSON, without an editor: the read-only doc view
 * adds a mark to the selected text (`addAnchorMark`), and DOC-10 restore keeps the anchors
 * that still have a thread (`restoredContent`). Isomorphic and pure.
 *
 * Text nodes are addressed by their index in a pre-order walk of the doc ("leaf"), the same
 * order `RichTextView` renders them in. The read view tags each markable leaf with
 * `TEXT_LEAF_MARK` (view only, never saved), so a DOM selection maps back to
 * `{ leaf, from, to }` offsets (UTF-16, like DOM and JS strings).
 */

/** View-only mark carrying a leaf index; rendered as `data-text-leaf` (renderers/). */
export const TEXT_LEAF_MARK = "hqTextLeaf";
export const TEXT_LEAF_ATTRIBUTE = "data-text-leaf";

export interface LeafSegment {
  leaf: number;
  /** Offsets inside the leaf's text, `from < to`. */
  from: number;
  to: number;
}

/**
 * Whether the anchor mark may go on this text: never in code (a code block allows no marks
 * and inline code excludes them in the editor), as `selectionQuote` refuses there too.
 */
function markable(node: RichTextNode, inCode: boolean): boolean {
  return !inCode && !(node.marks ?? []).some((mark) => mark.type === "code");
}

/** Rebuilds the doc, replacing each text node with what `replace` returns (pre-order). */
function mapLeaves<T extends RichTextNode>(
  doc: T,
  replace: (node: RichTextNode, leaf: number, inCode: boolean) => RichTextNode[],
): T {
  let leaf = 0;
  const visit = (node: RichTextNode, inCode: boolean): RichTextNode[] => {
    if (node.type === "text") {
      const index = leaf;
      leaf += 1;
      return replace(node, index, inCode);
    }
    if (!node.content) return [node];
    const childInCode = inCode || node.type === "codeBlock";
    return [{ ...node, content: node.content.flatMap((child) => visit(child, childInCode)) }];
  };
  if (doc.type === "text" || !doc.content) return doc;
  const childInCode = doc.type === "codeBlock";
  return { ...doc, content: doc.content.flatMap((child) => visit(child, childInCode)) };
}

const anchorMark = (anchorId: string): RichTextMark => ({
  type: COMMENT_ANCHOR_MARK,
  attrs: { anchorId },
});

/** A text node with new text and marks (no `marks` key when there are none). */
const withMarks = (node: RichTextNode, text: string, marks: RichTextMark[]): RichTextNode => {
  const out: RichTextNode = { type: node.type, text };
  if (node.attrs) out.attrs = node.attrs;
  if (marks.length > 0) out.marks = marks;
  return out;
};

const tagMark = (leaf: number): RichTextMark => ({ type: TEXT_LEAF_MARK, attrs: { leaf } });

/**
 * The doc with every markable leaf tagged with its index, for the read-only view only. The
 * tag is the outermost mark, so its element wraps exactly the leaf's text.
 */
export function tagTextLeaves<T extends RichTextNode>(doc: T): T {
  return mapLeaves(doc, (node, leaf, inCode) =>
    markable(node, inCode)
      ? [withMarks(node, node.text ?? "", [...(node.marks ?? []), tagMark(leaf)])]
      : [node],
  );
}

/** The leaf index of a `TEXT_LEAF_MARK`, or null when malformed. */
export function textLeafIndex(mark: RichTextMark): number | null {
  if (mark.type !== TEXT_LEAF_MARK) return null;
  const leaf = mark.attrs?.leaf;
  return typeof leaf === "number" && Number.isInteger(leaf) && leaf >= 0 ? leaf : null;
}

/**
 * Adds a comment anchor over `segments` (several leaves for a selection across formatting
 * or paragraphs). Leaves that cannot carry the mark are skipped. `changed` is false when
 * nothing was marked (e.g. only code was selected).
 */
export function addAnchorMark<T extends RichTextNode>(
  doc: T,
  segments: readonly LeafSegment[],
  anchorId: string,
): { doc: T; changed: boolean } {
  const byLeaf = new Map<number, { from: number; to: number }>();
  for (const segment of segments) {
    if (!Number.isInteger(segment.leaf) || segment.to <= segment.from) continue;
    const known = byLeaf.get(segment.leaf);
    byLeaf.set(segment.leaf, {
      from: Math.min(segment.from, known?.from ?? segment.from),
      to: Math.max(segment.to, known?.to ?? segment.to),
    });
  }
  let changed = false;
  const next = mapLeaves(doc, (node, leaf, inCode) => {
    const range = byLeaf.get(leaf);
    const text = node.text ?? "";
    if (!range || !markable(node, inCode)) return [node];
    const from = Math.max(0, Math.min(range.from, text.length));
    const to = Math.max(from, Math.min(range.to, text.length));
    if (to === from) return [node];
    changed = true;
    const marks = node.marks ?? [];
    const parts: RichTextNode[] = [];
    if (from > 0) parts.push(withMarks(node, text.slice(0, from), marks));
    parts.push(withMarks(node, text.slice(from, to), [...marks, anchorMark(anchorId)]));
    if (to < text.length) parts.push(withMarks(node, text.slice(to), marks));
    return parts;
  });
  return { doc: next, changed };
}

/** Drops the marks of anchors `drop` says to (other marks stay). */
function filterAnchors<T extends RichTextNode>(doc: T, drop: (anchorId: string) => boolean): T {
  return mapLeaves(doc, (node) => {
    const marks = node.marks ?? [];
    const kept = marks.filter((mark) => {
      if (mark.type !== COMMENT_ANCHOR_MARK) return true;
      const id = markAnchorId(mark);
      return id !== null && !drop(id);
    });
    return kept.length === marks.length ? [node] : [withMarks(node, node.text ?? "", kept)];
  });
}

/** Removes one anchor's mark everywhere (a comment that was not created after all). */
export function removeAnchorMark<T extends RichTextNode>(doc: T, anchorId: string): T {
  return filterAnchors(doc, (id) => id === anchorId);
}

/** The text each anchor covers, in document order (its pieces joined). */
export function anchorTexts(doc: RichTextNode | null | undefined): Map<string, string> {
  const texts = new Map<string, string>();
  if (!doc) return texts;
  mapLeaves(doc, (node) => {
    for (const mark of node.marks ?? []) {
      const id = markAnchorId(mark);
      if (id) texts.set(id, `${texts.get(id) ?? ""}${node.text ?? ""}`);
    }
    return [node];
  });
  return texts;
}

/** Runs of adjacent markable text nodes inside one block, with their leaf indices. */
function textRuns(doc: RichTextNode): { leaf: number; text: string }[][] {
  const runs: { leaf: number; text: string }[][] = [];
  let leaf = 0;
  const visit = (node: RichTextNode, inCode: boolean) => {
    if (!node.content) return;
    const childInCode = inCode || node.type === "codeBlock";
    let run: { leaf: number; text: string }[] = [];
    for (const child of node.content) {
      if (child.type === "text") {
        if (markable(child, childInCode)) run.push({ leaf, text: child.text ?? "" });
        else if (run.length > 0) {
          runs.push(run);
          run = [];
        }
        leaf += 1;
        continue;
      }
      // An inline atom (mention, hard break) or a nested block ends the run.
      if (run.length > 0) {
        runs.push(run);
        run = [];
      }
      visit(child, childInCode);
    }
    if (run.length > 0) runs.push(run);
  };
  visit(doc, false);
  return runs;
}

/**
 * Marks the first occurrence of `quote` (exact text, possibly across formatting within one
 * block) with `anchorId`. Unchanged when the text does not occur.
 */
export function reanchor<T extends RichTextNode>(doc: T, anchorId: string, quote: string): T {
  if (quote.trim() === "") return doc;
  for (const run of textRuns(doc)) {
    const joined = run.map((item) => item.text).join("");
    const at = joined.indexOf(quote);
    if (at < 0) continue;
    const end = at + quote.length;
    const segments: LeafSegment[] = [];
    let offset = 0;
    for (const item of run) {
      const from = Math.max(at, offset) - offset;
      const to = Math.min(end, offset + item.text.length) - offset;
      if (to > from) segments.push({ leaf: item.leaf, from, to });
      offset += item.text.length;
    }
    return addAnchorMark(doc, segments, anchorId).doc;
  }
  return doc;
}

/**
 * DOC-10 restore content: the old version, keeping the comment anchors that still exist.
 * Marks of anchors without a thread any more are dropped; a thread anchored in the current
 * content but not in the old one is anchored again where its exact text occurs in the old
 * content (else it stays orphaned, as when its text is deleted).
 */
export function restoredContent<T extends RichTextNode>(
  old: T,
  current: RichTextNode | null,
  threadAnchorIds: ReadonlySet<string>,
): T {
  let result = filterAnchors(old, (id) => !threadAnchorIds.has(id));
  const present = new Set(anchorIdsInOrder(result));
  for (const [id, text] of anchorTexts(current)) {
    if (!threadAnchorIds.has(id) || present.has(id)) continue;
    result = reanchor(result, id, text);
  }
  return result;
}
