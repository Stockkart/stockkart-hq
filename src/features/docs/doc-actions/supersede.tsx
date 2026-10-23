"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { callAction } from "@/features/issue/client-utils";
import { adrLabel, splitAdrTitle } from "@/lib/docs/adr";
import { DOC_TITLE_MAX } from "@/lib/docs/schemas";
import { docEditPath, docPath } from "@/lib/docs/views";
import { supersedeAdrAction } from "@/server/actions/docs";

import { type DocAction, type DocActionDialogProps } from "./types";

/**
 * ADR-3 "Supersede with new ADR…": a new ADR (next number, the ADR template with
 * "Supersedes: [NNNN](…)" in its Context, status Proposed) and the old one marked
 * superseded by it, in one statement on the server; the new ADR then opens in edit mode.
 * An ADR that already has a successor offers a link to it instead.
 */

function SupersedeDialog({ context, open, onOpenChange }: DocActionDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const titleId = useId();
  const { doc } = context;

  function submit() {
    startTransition(async () => {
      // Pending edits of the old ADR first, so nothing is left behind unsaved.
      await context.flush();
      const created = await callAction(() => supersedeAdrAction({ docId: doc.id, title }));
      if (!created) return;
      onOpenChange(false);
      setTitle("");
      toast.success(`Created ${created.title}; ${adrLabel(doc.adrNumber)} is now superseded`);
      router.push(docEditPath(doc.projectKey, created.id));
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Supersede {adrLabel(doc.adrNumber)}</DialogTitle>
            <DialogDescription>
              Creates the next ADR from the template, linked as its successor. This ADR becomes
              Superseded.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <label htmlFor={titleId} className="text-sm font-medium">
              New decision title
            </label>
            <Input
              id={titleId}
              autoFocus
              value={title}
              maxLength={DOC_TITLE_MAX - 6}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? "Creating…" : "Create and supersede"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const supersedeAction: DocAction = {
  id: "supersede-adr",
  visible: ({ doc }) => doc.type === "adr" && doc.adrNumber !== null && !doc.adrSupersededBy,
  label: "Supersede with new ADR…",
  dialog: SupersedeDialog,
};

/** Blocked once superseded: the menu links to the successor instead (supersede that one). */
export const openSuccessorAction: DocAction = {
  id: "open-successor",
  visible: ({ doc }) => doc.type === "adr" && doc.adrSupersededBy !== null,
  label: ({ doc }) =>
    `Superseded by ${adrLabel(splitAdrTitle(doc.adrSupersededBy?.title ?? "")?.number ?? null)}: open it`,
  run({ doc, navigate }) {
    if (doc.adrSupersededBy) navigate(docPath(doc.projectKey, doc.adrSupersededBy.id));
  },
};
