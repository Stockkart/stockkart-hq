"use client";

import { MessageSquarePlus } from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";

import { Button } from "@/components/ui/button";
import {
  COMMENT_ANCHOR_ATTRIBUTE,
  COMMENT_REQUEST_EVENT,
  COMMENT_SHORTCUT_LABEL,
  type CommentRequestDetail,
  isCommentRequestEvent,
} from "@/features/editor/comment-anchor-events";
import { callAction } from "@/features/issue/client-utils";
import { attachmentIdsIn } from "@/lib/attachments/nodes";
import { isAnchorId } from "@/lib/doc-comments/anchors";
import { type DocThreadView, threadSections } from "@/lib/doc-comments/views";
import { type RichTextDoc } from "@/lib/rich-text";
import { adoptCommentAttachmentsAction } from "@/server/actions/attachments";
import {
  createDocCommentAction,
  deleteDocCommentAction,
  editDocCommentAction,
  resolveDocThreadAction,
} from "@/server/actions/doc-comments";

import { CommentComposer } from "./comment-composer";
import { CommentThread, type ThreadActions } from "./comment-thread";
import { applyThreadUpdate, highlightCss, threadOfComment } from "./thread-state";

export interface DocCommentsPanelProps {
  docId: string;
  threads: DocThreadView[];
  /** `anchorIdsInOrder(<the editor's current content>)`: orders threads, finds orphans. */
  anchorOrder: string[];
  projectKeys: string[];
  currentUser: { id: string; name: string };
  /**
   * Docs UX: the panel stays mounted while its side panel is collapsed (so the editor's
   * and the read view's comment requests still reach it). It asks to be shown with
   * `onActivate` when a thread is focused (anchor click, `#comment-<id>`, a new inline
   * comment), and focuses/scrolls only once `visible`.
   */
  visible?: boolean;
  onActivate?: () => void;
}

/** A new thread being written: inline (`anchor`) or page-level, with text to restore. */
interface Draft {
  anchor: CommentRequestDetail | null;
  initial: RichTextDoc | null;
}

const COMMENT_HASH = /^#comment-([0-9a-f-]{36})$/i;

const anchorSelector = (anchorId: string) =>
  `.rich-text [${COMMENT_ANCHOR_ATTRIBUTE}="${anchorId}"]`;

/** Focuses a thread in the panel (opening "Resolved" if it is there); false if not shown. */
function focusThread(threadId: string): boolean {
  const element = document.getElementById(`thread-${threadId}`);
  if (!element) return false;
  // A resolved thread lives in the collapsed "Resolved" section.
  const details = element.closest("details");
  if (details && !details.open) details.open = true;
  element.focus();
  element.scrollIntoView({ block: "nearest" });
  return true;
}

function showThread(target: { id: string; focus: boolean }) {
  if (target.focus) {
    focusThread(target.id);
    return;
  }
  document
    .getElementById(`thread-${target.id}`)
    ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/**
 * DOC-11 / DOC-13 comments panel on the doc page. Inline threads are listed in the order
 * their text appears in the doc, then those whose text was deleted ("Original text
 * removed", still resolvable), then page-level comments, then a "Resolved" section. Open
 * anchors are highlighted in the editor (resolved ones are not); clicking highlighted text
 * opens its thread here. Every change is shown at once and rolled back if the server
 * refuses (`useOptimistic`). Arrow keys move between threads; everything is a button.
 */
export function DocCommentsPanel({
  docId,
  threads,
  anchorOrder,
  projectKeys,
  currentUser,
  visible = true,
  onActivate,
}: DocCommentsPanelProps) {
  const [optimistic, update] = useOptimistic(threads, applyThreadUpdate);
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const focusTarget = useRef<{ id: string; resolved: boolean } | null>(null);
  const headingId = useId();
  const latest = useRef(optimistic);
  const pendingAnchor = useRef<CommentRequestDetail | null>(null);
  // A thread to scroll to / focus once the panel is shown (it may be collapsed now).
  const reveal = useRef<{ id: string; focus: boolean } | null>(null);
  const activate = useRef(onActivate);
  const shown = useRef(visible);
  useEffect(() => {
    latest.current = optimistic;
    activate.current = onActivate;
    shown.current = visible;
  });
  /** Scrolls to (and maybe focuses) a thread now if the panel is shown, else once it is. */
  const revealThread = useRef((target: { id: string; focus: boolean }) => {
    if (shown.current) {
      showThread(target);
      return;
    }
    reveal.current = target;
    activate.current?.();
  });

  // The editor's "Comment" (button, toolbar, ⌘/Ctrl+Alt+M) asks here first (DOC-13).
  useEffect(() => {
    const onRequest = (event: Event) => {
      if (!isCommentRequestEvent(event)) return;
      // Accepting it is what makes the editor add the mark.
      event.preventDefault();
      pendingAnchor.current?.discard();
      pendingAnchor.current = event.detail;
      setActiveId(null);
      setDraft({ anchor: event.detail, initial: null });
      activate.current?.();
    };
    document.addEventListener(COMMENT_REQUEST_EVENT, onRequest);
    return () => {
      document.removeEventListener(COMMENT_REQUEST_EVENT, onRequest);
      // Leaving with an inline draft open: its mark has no thread, so take it out again.
      pendingAnchor.current?.discard();
      pendingAnchor.current = null;
    };
  }, []);

  // Clicking highlighted text opens its (open) thread; the caret stays in the doc.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest(`.rich-text [${COMMENT_ANCHOR_ATTRIBUTE}]`);
      const anchorId = anchor?.getAttribute(COMMENT_ANCHOR_ATTRIBUTE);
      if (!isAnchorId(anchorId)) return;
      const thread = latest.current.find(
        (item) => item.anchorId === anchorId && item.resolvedAt === null,
      );
      if (!thread) return;
      setActiveId(thread.id);
      revealThread.current({ id: thread.id, focus: false });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // A notification link (`#comment-<id>`) opens its thread (DOM only: focus and scroll),
  // on load and when the hash changes on this page.
  useEffect(() => {
    const openFromHash = () => {
      const match = COMMENT_HASH.exec(window.location.hash);
      const thread = match?.[1] ? threadOfComment(latest.current, match[1]) : null;
      if (!thread) return;
      revealThread.current({ id: thread.id, focus: true });
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  // A thread asked for (anchor click, hash) once the panel is shown.
  useEffect(() => {
    const target = reveal.current;
    if (!target || !visible) return;
    reveal.current = null;
    showThread(target);
  });

  // Focus follows a thread that moved (resolved/reopened) once it is rendered in its place.
  useEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    const thread = latest.current.find((item) => item.id === target.id);
    if (thread && (thread.resolvedAt !== null) !== target.resolved) return;
    if (focusThread(target.id)) focusTarget.current = null;
  });

  const sections = threadSections(optimistic, anchorOrder);
  const openAnchors = [...sections.anchored.map((thread) => thread.anchorId ?? "")];
  if (draft?.anchor) openAnchors.push(draft.anchor.anchorId);
  const active = optimistic.find((thread) => thread.id === activeId) ?? null;
  const activeAnchor = draft?.anchor?.anchorId ?? active?.anchorId ?? null;
  const css = highlightCss(openAnchors, activeAnchor);

  function closeDraft(cancelled: boolean) {
    if (cancelled) {
      draft?.anchor?.discard();
      draft?.anchor?.restoreFocus();
    }
    pendingAnchor.current = null;
    setDraft(null);
  }

  function createThread(body: RichTextDoc, anchor: CommentRequestDetail | null): boolean {
    const now = new Date();
    pendingAnchor.current = null;
    setDraft(null);
    startTransition(async () => {
      update({
        kind: "addThread",
        thread: {
          id: `pending-${crypto.randomUUID()}`,
          authorId: currentUser.id,
          authorName: currentUser.name,
          body,
          createdAt: now,
          editedAt: null,
          anchorId: anchor?.anchorId ?? null,
          anchorText: anchor?.text ?? null,
          resolvedAt: null,
          resolvedByName: null,
          replies: [],
        },
      });
      const created = await callAction(() =>
        createDocCommentAction({
          docId,
          body,
          anchor: anchor ? { id: anchor.anchorId, text: anchor.text } : undefined,
        }),
      );
      if (created === null) {
        // Rolled back; reopen the composer with the text (the mark is still in the doc).
        pendingAnchor.current = anchor;
        setDraft({ anchor, initial: body });
        return;
      }
      await adoptFiles(created.id, body);
      setActiveId(created.threadId);
    });
    return true;
  }

  /** Files pasted into a new comment were attached to the doc; move them onto it (ISS-9). */
  async function adoptFiles(commentId: string, body: RichTextDoc) {
    const attachmentIds = attachmentIdsIn(body);
    if (attachmentIds.length === 0) return;
    await callAction(() => adoptCommentAttachmentsAction({ commentId, attachmentIds }));
  }

  const actions: ThreadActions = {
    reply(threadId, body, onFailed) {
      startTransition(async () => {
        update({
          kind: "addReply",
          threadId,
          reply: {
            id: `pending-${crypto.randomUUID()}`,
            authorId: currentUser.id,
            authorName: currentUser.name,
            body,
            createdAt: new Date(),
            editedAt: null,
          },
        });
        const created = await callAction(() =>
          createDocCommentAction({ docId, body, parentId: threadId }),
        );
        if (created === null) onFailed(body);
        else await adoptFiles(created.id, body);
      });
    },
    edit(commentId, body, onFailed) {
      startTransition(async () => {
        update({ kind: "edit", commentId, body });
        const result = await callAction(() => editDocCommentAction({ commentId, body }));
        if (result === null) onFailed(body);
      });
    },
    remove(commentId) {
      if (!window.confirm("Delete this comment?")) return;
      startTransition(async () => {
        update({ kind: "delete", commentId });
        await callAction(() => deleteDocCommentAction({ commentId }));
      });
    },
    setResolved(thread, resolved) {
      focusTarget.current = { id: thread.id, resolved };
      setActiveId(thread.id);
      startTransition(async () => {
        update({
          kind: "resolve",
          threadId: thread.id,
          resolvedAt: resolved ? new Date() : null,
          resolvedByName: resolved ? currentUser.name : null,
        });
        const result = await callAction(() =>
          resolveDocThreadAction({ commentId: thread.id, resolved }),
        );
        // Rolled back: the thread stays where it was, so stop waiting to focus it.
        if (result === null) focusTarget.current = null;
      });
    },
    showInDoc(thread) {
      setActiveId(thread.id);
      if (!thread.anchorId || !isAnchorId(thread.anchorId)) return;
      document
        .querySelector(anchorSelector(thread.anchorId))
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    },
  };

  /**
   * ↑/↓ move to the previous/next thread, from the thread itself or any of its buttons
   * (not while typing in a comment editor, where the arrows move the caret).
   */
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('[contenteditable="true"], input, textarea, [role="listbox"]')) return;
    const current = target.closest<HTMLElement>("[data-thread]");
    if (!current) return;
    const all = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-thread]")];
    const next = all[all.indexOf(current) + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  const renderThread = (thread: DocThreadView, orphaned = false) => (
    <li key={thread.id}>
      <CommentThread
        thread={thread}
        orphaned={orphaned}
        active={thread.id === activeId}
        docId={docId}
        projectKeys={projectKeys}
        currentUserId={currentUser.id}
        actions={actions}
      />
    </li>
  );
  const inline = [...sections.anchored, ...sections.orphaned];
  const openCount = inline.length + sections.page.length;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      {css ? <style>{css}</style> : null}
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-semibold">
          Comments{openCount > 0 ? ` (${openCount})` : ""}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          disabled={draft !== null && draft.anchor === null}
          onClick={() => {
            pendingAnchor.current?.discard();
            pendingAnchor.current = null;
            setDraft({ anchor: null, initial: null });
          }}
        >
          <MessageSquarePlus aria-hidden="true" />
          Comment on page
        </Button>
      </div>

      {draft ? (
        <div className="flex flex-col gap-2 rounded-md border p-2">
          {draft.anchor ? (
            <q className="line-clamp-3 rounded border-l-2 border-amber-600 bg-muted/60 px-2 py-1 text-xs dark:border-amber-400">
              {draft.anchor.text}
            </q>
          ) : null}
          <CommentComposer
            key={draft.anchor?.anchorId ?? "page"}
            label={draft.anchor ? "Comment on the selected text" : "Comment on this page"}
            placeholder="Write a comment… (⌘/Ctrl+Enter to send)"
            submitLabel="Comment"
            initialContent={draft.initial}
            target={{ entityType: "doc", entityId: docId }}
            draft
            projectKeys={projectKeys}
            onCancel={() => closeDraft(true)}
            onSubmit={(body) => createThread(body, draft.anchor)}
          />
        </div>
      ) : null}

      <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
        {openCount === 0 && !draft ? (
          <p className="text-sm text-muted-foreground">
            No comments. Select text and press {COMMENT_SHORTCUT_LABEL}, or comment on the page.
          </p>
        ) : null}
        {inline.length > 0 ? (
          <ol className="flex flex-col gap-2" aria-label="Comments on the text">
            {sections.anchored.map((thread) => renderThread(thread))}
            {sections.orphaned.map((thread) => renderThread(thread, true))}
          </ol>
        ) : null}
        {sections.page.length > 0 ? (
          <ol className="flex flex-col gap-2" aria-label="Page comments">
            {sections.page.map((thread) => renderThread(thread))}
          </ol>
        ) : null}
        {sections.resolved.length > 0 ? (
          <details className="flex flex-col gap-2">
            <summary className="cursor-pointer rounded text-xs font-medium text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              Resolved ({sections.resolved.length})
            </summary>
            <ol className="mt-2 flex flex-col gap-2" aria-label="Resolved comments">
              {sections.resolved.map((thread) =>
                renderThread(
                  thread,
                  thread.anchorId !== null && !anchorOrder.includes(thread.anchorId),
                ),
              )}
            </ol>
          </details>
        ) : null}
      </div>
    </section>
  );
}
