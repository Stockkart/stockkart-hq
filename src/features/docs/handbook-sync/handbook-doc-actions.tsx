"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { canPull } from "@/lib/handbook/sync-state";

import { type DocAction, type DocActionDialogProps } from "../doc-actions/types";

import { handbookStatusOf } from "./handbook-header-badge";
import { PublishDialog } from "./publish-dialog";
import { PullDialog } from "./pull-dialog";

/**
 * DOC-14 entries of the doc header's "⋯" menu (`DOC_ACTIONS`): "Publish to handbook" and
 * "Review & pull". Shown in read and edit mode alike. Without the GitHub App both are
 * disabled with the reason (the server actions fail closed anyway).
 *
 * - Publish exports the doc's SAVED version (the server reads it). In edit mode the dialog
 *   saves pending edits first; a save that did not land blocks it with "Save first".
 * - Pull applies the handbook file as a new HQ version. In edit mode it first leaves edit
 *   mode the way "Done" does (save, then read mode), so the applied version shows in read
 *   mode afterwards and no open editor is left on the old version.
 */

export const HANDBOOK_NOT_SET_UP = "Handbook sync isn't set up";
export const HANDBOOK_PR_OPEN = "A publish PR is already open";

function PublishActionDialog({ context, open, onOpenChange }: DocActionDialogProps) {
  const sync = context.doc.handbook;
  if (!sync) return null;
  return (
    <PublishDialog
      open={open}
      onOpenChange={onOpenChange}
      projectKey={context.doc.projectKey}
      docId={context.doc.id}
      initialPath={sync.path}
      prepare={context.flush}
    />
  );
}

function PullActionDialog({ context, open, onOpenChange }: DocActionDialogProps) {
  const [step, setStep] = useState<"leaving" | "pull" | "publish">(
    context.editing ? "leaving" : "pull",
  );

  useEffect(() => {
    if (step !== "leaving") return;
    let active = true;
    void context.toReadMode().then((left) => {
      if (!active) return;
      if (left) setStep("pull");
      else onOpenChange(false);
    });
    return () => {
      active = false;
    };
    // Once per opening: the step only starts as "leaving".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = context.doc.handbook;
  if (!sync) return null;
  if (step === "leaving") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Review &amp; pull from the handbook</DialogTitle>
            <DialogDescription aria-live="polite">
              Saving your changes and leaving edit mode…
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }
  if (step === "publish") {
    return (
      <PublishDialog
        open={open}
        onOpenChange={onOpenChange}
        projectKey={context.doc.projectKey}
        docId={context.doc.id}
        initialPath={sync.path}
        prepare={context.flush}
      />
    );
  }
  return (
    <PullDialog
      open={open}
      onOpenChange={onOpenChange}
      docId={context.doc.id}
      // "Keep HQ version": the publish dialog in the same opening (it asks to overwrite).
      onKeepHq={() => setStep("publish")}
    />
  );
}

export const publishToHandbookAction: DocAction = {
  id: "handbook-publish",
  label: "Publish to handbook",
  visible: ({ doc }) => doc.handbook !== null,
  disabledReason: ({ doc, handbookConfigured }) => {
    if (!handbookConfigured) return HANDBOOK_NOT_SET_UP;
    return handbookStatusOf(doc) === "pr_open" ? HANDBOOK_PR_OPEN : null;
  },
  dialog: PublishActionDialog,
};

export const pullFromHandbookAction: DocAction = {
  id: "handbook-pull",
  label: "Review & pull",
  visible: ({ doc }) => {
    const status = handbookStatusOf(doc);
    return status !== null && (canPull(status) || status === "removed_in_handbook");
  },
  disabledReason: ({ handbookConfigured }) => (handbookConfigured ? null : HANDBOOK_NOT_SET_UP),
  dialog: PullActionDialog,
};
