"use client";

import { Check, CornerDownRight, RotateCcw, TextQuote } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { RichTextView } from "@/features/editor/rich-text-view";
import { RelativeTime } from "@/features/issue/client-utils";
import { Avatar } from "@/features/issue/issue-badges";
import { type DocCommentView, type DocThreadView } from "@/lib/doc-comments/views";
import { type RichTextDoc } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

import { CommentComposer } from "./comment-composer";

/** What a thread can ask the panel to do (each is optimistic, rolled back on failure). */
export interface ThreadActions {
  reply: (threadId: string, body: RichTextDoc, onFailed: (body: RichTextDoc) => void) => void;
  edit: (commentId: string, body: RichTextDoc, onFailed: (body: RichTextDoc) => void) => void;
  remove: (commentId: string) => void;
  setResolved: (thread: DocThreadView, resolved: boolean) => void;
  /** Scrolls the anchored text into view and marks the thread active. */
  showInDoc: (thread: DocThreadView) => void;
}

/** True while an optimistic item has no server id yet (its actions wait). */
export const isPendingId = (id: string) => id.startsWith("pending-");

export function CommentThread({
  thread,
  orphaned,
  active,
  docId,
  projectKeys,
  currentUserId,
  actions,
}: {
  thread: DocThreadView;
  orphaned: boolean;
  active: boolean;
  docId: string;
  projectKeys: string[];
  currentUserId: string;
  actions: ThreadActions;
}) {
  const [replying, setReplying] = useState(false);
  const [replyDraft, setReplyDraft] = useState<RichTextDoc | null>(null);
  const replyButton = useRef<HTMLButtonElement>(null);
  const pending = isPendingId(thread.id);
  const resolved = thread.resolvedAt !== null;
  const headingId = `thread-${thread.id}-heading`;
  const author = thread.authorName ?? "Former user";

  function closeReply() {
    setReplying(false);
    requestAnimationFrame(() => replyButton.current?.focus());
  }

  return (
    <article
      id={`thread-${thread.id}`}
      data-thread=""
      tabIndex={-1}
      aria-labelledby={headingId}
      className={cn(
        "flex scroll-mt-20 flex-col gap-2 rounded-md border p-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active && "border-amber-600 dark:border-amber-400",
        resolved && "bg-muted/40",
      )}
    >
      <h3 id={headingId} className="sr-only">
        {thread.anchorId === null ? "Page comment" : "Comment on text"} by {author}
        {resolved ? ", resolved" : ""}
      </h3>
      {thread.anchorId !== null ? (
        orphaned ? (
          <div className="flex flex-col gap-0.5 rounded bg-muted px-2 py-1 text-xs">
            <span className="font-medium">Original text removed</span>
            {thread.anchorText ? (
              <q className="text-muted-foreground line-through decoration-muted-foreground/60">
                {thread.anchorText}
              </q>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            className="flex items-start gap-1.5 rounded border-l-2 border-amber-600 bg-muted/60 px-2 py-1 text-left text-xs outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:border-amber-400"
            onClick={() => actions.showInDoc(thread)}
          >
            <TextQuote aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0">
              <span className="sr-only">Show in doc: </span>
              <q className="line-clamp-3">{thread.anchorText ?? "(no text)"}</q>
            </span>
          </button>
        )
      ) : null}

      <CommentBody
        comment={thread}
        own={thread.authorId === currentUserId}
        projectKeys={projectKeys}
        pending={pending}
        actions={actions}
      />

      {thread.replies.length > 0 ? (
        <ol className="flex flex-col gap-2 border-l pl-3" aria-label="Replies">
          {thread.replies.map((reply) => (
            <li key={reply.id}>
              <CommentBody
                comment={reply}
                own={reply.authorId === currentUserId}
                projectKeys={projectKeys}
                pending={isPendingId(reply.id)}
                actions={actions}
              />
            </li>
          ))}
        </ol>
      ) : null}

      {resolved ? (
        <p className="text-xs text-muted-foreground">
          Resolved{thread.resolvedByName ? ` by ${thread.resolvedByName}` : ""}
          {thread.resolvedAt ? (
            <>
              {" "}
              <RelativeTime date={thread.resolvedAt} />
            </>
          ) : null}
        </p>
      ) : null}

      {replying ? (
        <CommentComposer
          label={`Reply to ${author}`}
          placeholder="Reply… (⌘/Ctrl+Enter to send)"
          submitLabel="Reply"
          initialContent={replyDraft}
          // A reply's files go to the doc first and move onto the reply once it exists.
          target={{ entityType: "doc", entityId: docId }}
          draft
          projectKeys={projectKeys}
          onCancel={closeReply}
          onSubmit={(body) => {
            actions.reply(thread.id, body, (failed) => {
              setReplyDraft(failed);
              setReplying(true);
            });
            setReplyDraft(null);
            closeReply();
            return true;
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-1">
          {thread.body !== null || thread.replies.length > 0 ? (
            <Button
              ref={replyButton}
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={pending}
              onClick={() => setReplying(true)}
            >
              <CornerDownRight aria-hidden="true" />
              Reply
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={pending}
            onClick={() => actions.setResolved(thread, !resolved)}
          >
            {resolved ? <RotateCcw aria-hidden="true" /> : <Check aria-hidden="true" />}
            {resolved ? "Reopen" : "Resolve"}
            <span className="sr-only"> thread</span>
          </Button>
        </div>
      )}
    </article>
  );
}

function CommentBody({
  comment,
  own,
  projectKeys,
  pending,
  actions,
}: {
  comment: DocCommentView;
  own: boolean;
  projectKeys: string[];
  pending: boolean;
  actions: ThreadActions;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RichTextDoc | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const author = comment.authorName ?? "Former user";

  function close() {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  }

  if (comment.body === null) {
    return <p className="text-xs text-muted-foreground italic">Comment deleted</p>;
  }
  const body = comment.body;

  return (
    // The anchor a comment notification opens (`#comment-<id>`, NTF-1).
    <div id={`comment-${comment.id}`} className="flex scroll-mt-20 gap-2">
      <Avatar name={author} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{author}</span>
          <span className="text-xs text-muted-foreground">
            {pending ? "Sending…" : <RelativeTime date={comment.createdAt} />}
            {comment.editedAt ? " · edited" : null}
          </span>
        </div>
        {editing ? (
          <CommentComposer
            label="Edit comment"
            submitLabel="Save"
            initialContent={draft ?? body}
            target={{ entityType: "comment", entityId: comment.id }}
            projectKeys={projectKeys}
            onCancel={close}
            onSubmit={(next) => {
              actions.edit(comment.id, next, (failed) => {
                setDraft(failed);
                setEditing(true);
              });
              setDraft(null);
              close();
              return true;
            }}
          />
        ) : (
          <RichTextView doc={body} projectKeys={projectKeys} className="text-sm" />
        )}
        {own && !editing && !pending ? (
          <span className="flex gap-1">
            <Button
              ref={editButton}
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              onClick={() => setEditing(true)}
            >
              Edit<span className="sr-only"> your comment</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              onClick={() => actions.remove(comment.id)}
            >
              Delete<span className="sr-only"> your comment</span>
            </Button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
