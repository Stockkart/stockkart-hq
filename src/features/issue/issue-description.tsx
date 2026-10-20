"use client";

import { Pencil } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { LazyRichTextEditor } from "@/features/editor/lazy-rich-text-editor";
import { RichTextView } from "@/features/editor/rich-text-view";
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

  function save() {
    const next = draft && !isEmptyDoc(draft) ? draft : null;
    startTransition(async () => {
      const result = await callAction(() =>
        updateIssueFieldAction({ issueId, field: "description", value: next }),
      );
      if (result === null) return;
      setShown(next);
      setEditing(false);
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
            onCancel={() => setEditing(false)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
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
