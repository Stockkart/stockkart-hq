"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LazyRichTextEditor } from "@/features/editor/lazy-rich-text-editor";
import { RichTextView } from "@/features/editor/rich-text-view";
import { type ActivityView, type CommentView, type ProjectMeta } from "@/lib/issues/views";
import { isEmptyDoc, type RichTextDoc } from "@/lib/rich-text";
import {
  createCommentAction,
  deleteCommentAction,
  editCommentAction,
} from "@/server/actions/issues";

import { describeActivity } from "./activity-format";
import { callAction, RelativeTime } from "./client-utils";
import { Avatar } from "./issue-badges";

interface IssueTabsProps {
  issueId: string;
  comments: CommentView[];
  activity: ActivityView[];
  issueKeys: Record<string, string>;
  meta: ProjectMeta;
  projectKeys: string[];
  currentUserId: string;
}

/** §5.4 "Comments | Activity" (ISS-7, ISS-8). */
export function IssueTabs(props: IssueTabsProps) {
  return (
    <Tabs defaultValue="comments">
      <TabsList aria-label="Discussion and history">
        <TabsTrigger value="comments">
          Comments{props.comments.length > 0 ? ` (${props.comments.length})` : ""}
        </TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="comments">
        <Comments {...props} />
      </TabsContent>
      <TabsContent value="activity">
        <ActivityList activity={props.activity} issueKeys={props.issueKeys} meta={props.meta} />
      </TabsContent>
    </Tabs>
  );
}

function Comments({ issueId, comments, projectKeys, currentUserId }: IssueTabsProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<RichTextDoc | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!draft || isEmptyDoc(draft) || pending) return;
    const body = draft;
    startTransition(async () => {
      const created = await callAction(() => createCommentAction({ issueId, body }));
      if (created === null) return;
      setDraft(null);
      // Remount the composer to clear it.
      setComposerKey((key) => key + 1);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ol className="flex flex-col gap-4" aria-label="Comments">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              projectKeys={projectKeys}
              own={comment.authorId === currentUserId}
            />
          ))}
        </ol>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <LazyRichTextEditor
          key={composerKey}
          initialContent={null}
          projectKeys={projectKeys}
          label="Write a comment"
          placeholder="Write a comment… (⌘/Ctrl+Enter to send)"
          onChange={setDraft}
          onSubmit={submit}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending || !draft || isEmptyDoc(draft)}>
            {pending ? "Sending…" : "Comment"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function CommentItem({
  comment,
  projectKeys,
  own,
}: {
  comment: CommentView;
  projectKeys: string[];
  own: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const [draft, setDraft] = useState<RichTextDoc>(comment.body);
  const [pending, startTransition] = useTransition();
  const author = comment.authorName ?? "Former user";

  function save() {
    if (isEmptyDoc(draft)) return;
    const next = draft;
    startTransition(async () => {
      const result = await callAction(() =>
        editCommentAction({ commentId: comment.id, body: next }),
      );
      if (result === null) return;
      setBody(next);
      setEditing(false);
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm("Delete this comment?")) return;
    startTransition(async () => {
      const result = await callAction(() => deleteCommentAction({ commentId: comment.id }));
      if (result !== null) router.refresh();
    });
  }

  return (
    <li className="flex gap-3">
      <Avatar name={author} className="mt-0.5 size-7" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">{author}</span>
          <span className="text-xs text-muted-foreground">
            <RelativeTime date={comment.createdAt} />
            {comment.editedAt ? " · edited" : null}
          </span>
          {own && !editing ? (
            <span className="ml-auto flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setDraft(body);
                  setEditing(true);
                }}
              >
                Edit<span className="sr-only"> your comment</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={pending}
                onClick={remove}
              >
                Delete<span className="sr-only"> your comment</span>
              </Button>
            </span>
          ) : null}
        </div>
        {editing ? (
          <div className="flex flex-col gap-2">
            <LazyRichTextEditor
              initialContent={body}
              projectKeys={projectKeys}
              label="Edit comment"
              autoFocus
              onChange={setDraft}
              onSubmit={save}
              onCancel={() => setEditing(false)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={pending}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <RichTextView doc={body} projectKeys={projectKeys} />
        )}
      </div>
    </li>
  );
}

function ActivityList({
  activity,
  issueKeys,
  meta,
}: {
  activity: ActivityView[];
  issueKeys: Record<string, string>;
  meta: ProjectMeta;
}) {
  const lookups = useMemo(
    () => ({
      statuses: new Map(meta.statuses.map((status) => [status.id, status.name])),
      users: new Map(meta.users.map((user) => [user.id, user.name])),
      components: new Map(meta.components.map((component) => [component.id, component.name])),
      issueKeys,
    }),
    [meta, issueKeys],
  );

  if (activity.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }
  return (
    <ol className="flex flex-col gap-2 text-sm" aria-label="Activity, newest first">
      {activity.map((entry) => {
        const sentence = describeActivity(entry, lookups);
        return (
          <li key={entry.id} className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-medium">{entry.actorName ?? "System"}</span>
            <span>{sentence.verb}</span>
            {sentence.from !== null ? (
              <>
                <span className="text-muted-foreground">from</span>
                <span className="rounded bg-muted px-1 line-through decoration-muted-foreground/60">
                  {sentence.from}
                </span>
              </>
            ) : null}
            {sentence.to !== null ? (
              <>
                {sentence.from !== null ? <span className="text-muted-foreground">to</span> : null}
                <span className="rounded bg-muted px-1">{sentence.to}</span>
              </>
            ) : null}
            <span className="text-xs text-muted-foreground">
              · <RelativeTime date={entry.createdAt} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
