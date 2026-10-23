"use client";

import { MessageSquarePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  COMMENT_REQUEST_EVENT,
  COMMENT_SHORTCUT_LABEL,
  type CommentRequestDetail,
} from "@/features/editor/comment-anchor-events";
import { RichTextView } from "@/features/editor/rich-text-view";
import { anchorQuote, newAnchorId } from "@/lib/doc-comments/anchors";
import {
  addAnchorMark,
  type LeafSegment,
  removeAnchorMark,
  TEXT_LEAF_ATTRIBUTE,
  tagTextLeaves,
} from "@/lib/docs/anchor-marks";
import { type RichTextDoc } from "@/lib/rich-text";
import { saveDocAction } from "@/server/actions/docs";

/**
 * Read mode of a doc (docs UX): the stored content through the safe renderer, so no editor
 * is loaded. Diagram embeds, attachments (images open the lightbox) and mentions render as
 * in any read-only rich text.
 *
 * DOC-13 inline comments work here too. Selecting text shows a floating "Comment" button
 * (or press ⌘/Ctrl+Alt+M); the selection is mapped to the stored JSON through the
 * view-only leaf tags (`tagTextLeaves`), the anchor mark is added to a copy of the content
 * and saved through `saveDocAction`, i.e. the §7.4 optimistic-lock path (based on the
 * version shown, so a newer save is never overwritten). Only once that save landed is the
 * comments panel asked (the same cancelable `hq:comment-anchor-request` event the editor
 * sends); cancelling the comment saves the doc without the mark again.
 */

export interface DocReadViewProps {
  docId: string;
  content: RichTextDoc | null;
  /** The version `content` is; the base of the anchor save. */
  version: number;
  projectKeys: string[];
  /** A save from here landed (the page shows that content and version from now on). */
  onSaved: (saved: { version: number; content: RichTextDoc }) => void;
}

/** Characters before (node, offset) inside `root` (UTF-16, like the stored text). */
function offsetWithin(root: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** The selected parts of each tagged text leaf inside `container`. */
export function selectionSegments(container: HTMLElement, range: Range): LeafSegment[] {
  const segments: LeafSegment[] = [];
  for (const span of container.querySelectorAll<HTMLElement>(`[${TEXT_LEAF_ATTRIBUTE}]`)) {
    if (!range.intersectsNode(span)) continue;
    const leaf = Number(span.getAttribute(TEXT_LEAF_ATTRIBUTE));
    if (!Number.isInteger(leaf) || leaf < 0) continue;
    const length = span.textContent?.length ?? 0;
    const from = span.contains(range.startContainer)
      ? offsetWithin(span, range.startContainer, range.startOffset)
      : 0;
    const to = span.contains(range.endContainer)
      ? offsetWithin(span, range.endContainer, range.endOffset)
      : length;
    if (to > from) segments.push({ leaf, from, to });
  }
  return segments;
}

interface Pending {
  segments: LeafSegment[];
  text: string;
  /** Where the floating button goes, relative to the view's wrapper. */
  top: number;
  left: number;
}

/** The commentable selection inside `container`, or null. */
function readSelection(container: HTMLElement): Pending | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const segments = selectionSegments(container, range);
  const text = anchorQuote(selection.toString());
  if (segments.length === 0 || !text) return null;
  let top = 0;
  let left = 0;
  try {
    const box = range.getBoundingClientRect();
    const parent = container.getBoundingClientRect();
    top = box.bottom - parent.top + 4;
    left = Math.max(0, box.right - parent.left - 32);
  } catch {
    // No layout (e.g. jsdom): keep the top-left corner.
  }
  return { segments, text, top, left };
}

export function DocReadView({ docId, content, version, projectKeys, onSaved }: DocReadViewProps) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  // The latest content and version (a save from here, or a refresh), for the discard save.
  const latest = useRef({ content, version });
  useEffect(() => {
    latest.current = { content, version };
  }, [content, version]);
  const tagged = useMemo(() => (content ? tagTextLeaves(content) : null), [content]);

  useEffect(() => {
    const onSelection = () => {
      const element = container.current;
      setPending(element ? readSelection(element) : null);
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, []);

  /** A locked save of `next`; false (with a toast) when it did not land. */
  async function save(next: RichTextDoc, base: number): Promise<number | null> {
    let result;
    try {
      result = await saveDocAction({ docId, baseVersion: base, content: next });
    } catch {
      toast.error("Could not save. Reload the page and try again.");
      return null;
    }
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    if (result.data.status === "conflict") {
      // Someone saved after the version shown: never overwrite it; show theirs instead.
      toast.error("This doc was just changed by someone else. Select the text again.");
      router.refresh();
      return null;
    }
    return result.data.version;
  }

  async function comment(selection: Pending | null = pending) {
    const element = container.current;
    const source = latest.current;
    if (!selection || !element || !source.content || busy) return;
    const anchorId = newAnchorId();
    const marked = addAnchorMark(source.content, selection.segments, anchorId);
    if (!marked.changed) return;
    setBusy(true);
    const saved = await save(marked.doc, source.version);
    setBusy(false);
    if (saved === null) return;
    latest.current = { content: marked.doc, version: saved };
    onSaved({ version: saved, content: marked.doc });
    window.getSelection()?.removeAllRanges();
    setPending(null);
    const detail: CommentRequestDetail = {
      anchorId,
      text: selection.text,
      discard: () => {
        // The comment was not created: take the mark out again (still a locked save).
        const now = latest.current;
        if (!now.content) return;
        const without = removeAnchorMark(now.content, anchorId);
        void save(without, now.version).then((version) => {
          if (version === null) return;
          latest.current = { content: without, version };
          onSaved({ version, content: without });
        });
      },
      restoreFocus: () => container.current?.focus(),
    };
    const event = new CustomEvent(COMMENT_REQUEST_EVENT, {
      bubbles: true,
      cancelable: true,
      detail,
    });
    // Nobody accepted it (no comments panel): the mark has no thread, so remove it.
    if (element.dispatchEvent(event)) detail.discard();
  }

  return (
    <div className="relative">
      <div
        ref={container}
        // Focusable so ⌘/Ctrl+Alt+M works on a keyboard selection and focus can return here.
        tabIndex={-1}
        className="outline-none"
        onKeyDown={(event) => {
          const isShortcut =
            (event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === "m";
          if (!isShortcut) return;
          const element = container.current;
          const selection = element ? readSelection(element) : null;
          if (!selection) return;
          event.preventDefault();
          void comment(selection);
        }}
      >
        <RichTextView
          doc={tagged}
          projectKeys={projectKeys}
          empty={<p className="text-sm text-muted-foreground">This doc is empty.</p>}
        />
      </div>
      {pending ? (
        <button
          type="button"
          className="comment-anchor-button"
          style={{ top: pending.top, left: pending.left }}
          aria-label={`Comment on the selected text (${COMMENT_SHORTCUT_LABEL})`}
          title={`Comment on the selected text (${COMMENT_SHORTCUT_LABEL})`}
          disabled={busy}
          // Keep the selection while clicking.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void comment()}
        >
          <MessageSquarePlus aria-hidden="true" className="mr-1 inline size-3.5" />
          {busy ? "Saving…" : "Comment"}
        </button>
      ) : null}
    </div>
  );
}
