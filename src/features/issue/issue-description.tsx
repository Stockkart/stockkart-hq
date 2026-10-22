"use client";

import { Pencil } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { LazyRichTextEditor } from "@/features/editor/lazy-rich-text-editor";
import { RichTextView } from "@/features/editor/rich-text-view";
import { hasPendingUploads, UPLOADS_RUNNING_MESSAGE } from "@/lib/attachments/nodes";
import { isEmptyDoc, type RichTextDoc } from "@/lib/rich-text";
import { updateIssueFieldAction } from "@/server/actions/issues";

import { callAction } from "./client-utils";

interface IssueDescriptionProps {
  issueId: string;
  description: RichTextDoc | null;
  projectKeys: string[];
}

/** §5.4 description: rendered view (links and STK chips work), "Edit" swaps in the editor. */
export function IssueDescription({ issueId, description, projectKeys }: IssueDescriptionProps) {
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(description);
  const [draft, setDraft] = useState<RichTextDoc | null>(description);
  const [pending, startTransition] = useTransition();
  const editButton = useRef<HTMLButtonElement>(null);

  // Follow the server copy after a refresh (e.g. someone else edited it), unless editing.
  const serverKey = JSON.stringify(description);
  const [seenKey, setSeenKey] = useState(serverKey);
  if (seenKey !== serverKey && !editing) {
    setSeenKey(serverKey);
    setShown(description);
  }

  /** Leaves edit mode and puts focus back on "Edit" (the editor is about to unmount). */
  function close() {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  }

  function save() {
    if (hasPendingUploads(draft)) {
      toast.error(UPLOADS_RUNNING_MESSAGE);
      return;
    }
    const next = draft && !isEmptyDoc(draft) ? draft : null;
    startTransition(async () => {
      const result = await callAction(() =>
        updateIssueFieldAction({ issueId, field: "description", value: next }),
      );
      if (result === null) return;
      setShown(next);
      close();
    });
  }

  return (
    <section aria-labelledby="description-heading" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 id="description-heading" className="text-sm font-semibold">
          Description
        </h2>
        {!editing ? (
          <Button
            ref={editButton}
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(shown);
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" />
            Edit<span className="sr-only"> description</span>
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <LazyRichTextEditor
            initialContent={shown}
            projectKeys={projectKeys}
            label="Description"
            placeholder="Describe the issue. Mention other issues as STK-123."
            autoFocus
            onChange={setDraft}
            onSubmit={save}
            onCancel={close}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <RichTextView
          doc={shown}
          projectKeys={projectKeys}
          empty={<p className="text-sm text-muted-foreground">No description.</p>}
        />
      )}
    </section>
  );
}
