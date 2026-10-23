"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AttachmentUploadProvider,
  useAttachmentUpload,
} from "@/features/attachments/upload-context";
import { LazyRichTextEditor } from "@/features/editor/lazy-rich-text-editor";
import { hasPendingUploads, UPLOADS_RUNNING_MESSAGE } from "@/lib/attachments/nodes";
import { isEmptyDoc, type RichTextDoc } from "@/lib/rich-text";

/**
 * The comment editor of the doc comments panel (new thread, reply, edit): the shared
 * `comment` editor, so @mentions (MY-1) and pasted files work as on issues. ⌘/Ctrl+Enter
 * sends, Escape cancels. Files pasted into a new comment go to the doc as drafts (`target`)
 * and move onto the comment once it exists (the panel does that); an edit's files go to the
 * comment itself.
 */
export function CommentComposer({
  label,
  placeholder,
  submitLabel,
  initialContent = null,
  target,
  draft = false,
  projectKeys,
  autoFocus = true,
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder?: string;
  submitLabel: string;
  initialContent?: RichTextDoc | null;
  target: { entityType: "doc" | "comment"; entityId: string };
  /** Files belong to `target` only until the comment is posted. */
  draft?: boolean;
  projectKeys: string[];
  autoFocus?: boolean;
  /** Returns once the comment was handed over (optimistically shown); false keeps the text. */
  onSubmit: (body: RichTextDoc) => boolean;
  onCancel?: () => void;
}) {
  const { storageReady } = useAttachmentUpload();
  const [body, setBody] = useState<RichTextDoc | null>(initialContent);
  const [key, setKey] = useState(0);
  const empty = !body || isEmptyDoc(body);

  function submit() {
    if (!body || isEmptyDoc(body)) return;
    if (hasPendingUploads(body)) {
      toast.error(UPLOADS_RUNNING_MESSAGE);
      return;
    }
    if (!onSubmit(body)) return;
    setBody(null);
    // Remount to clear the editor.
    setKey((value) => value + 1);
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <AttachmentUploadProvider target={target} storageReady={storageReady} draft={draft}>
        <LazyRichTextEditor
          key={key}
          variant="comment"
          initialContent={initialContent}
          projectKeys={projectKeys}
          label={label}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={setBody}
          onSubmit={submit}
          onCancel={onCancel}
        />
      </AttachmentUploadProvider>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={empty}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
