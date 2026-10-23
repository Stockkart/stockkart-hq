"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
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
import { callAction } from "@/features/issue/client-utils";
import { type PullPreview, type PullState } from "@/lib/handbook/views";
import { handbookPullApplyAction, handbookPullPreviewAction } from "@/server/actions/handbook";

import { LineDiffView } from "../diff/line-diff-view";

const MESSAGES: Record<PullState, string> = {
  repo_ahead:
    "HQ has not changed since the last sync, so this is a clean pull: the handbook's version becomes a new HQ version.",
  both_changed:
    "Both changed: this doc was edited in HQ and in the handbook since the last sync. Take the handbook version (your HQ copy stays in the version history), or keep the HQ version and publish it over the handbook's changes.",
  in_sync: "HQ and the handbook have the same content. Nothing to pull.",
  hq_ahead:
    "The handbook file is what HQ last synced; only HQ changed. Nothing to pull: publish instead.",
  removed:
    "The file was removed from the handbook. Publish to add it back, or delete the doc in HQ.",
};

/**
 * DOC-14 "Review & pull": the diff of HQ (old) against the handbook's file on the default
 * branch (new), read through a server action when the dialog opens. Mounted per opening.
 */
export function PullDialog({
  open,
  onOpenChange,
  docId,
  onKeepHq,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docId: string;
  /** "Keep HQ version": continue in the publish dialog (which asks to overwrite). */
  onKeepHq: () => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<PullPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [applying, startApplying] = useTransition();

  useEffect(() => {
    startLoading(async () => {
      try {
        const result = await handbookPullPreviewAction({ docId });
        if (result.ok) setPreview(result.data);
        else setError(result.error);
      } catch {
        setError("Something went wrong. Reload the page and try again.");
      }
    });
  }, [docId]);

  function take() {
    if (!preview?.remoteSha) return;
    const remoteSha = preview.remoteSha;
    startApplying(async () => {
      const done = await callAction(() =>
        handbookPullApplyAction({ docId, baseVersion: preview.baseVersion, remoteSha }),
      );
      if (!done) return;
      toast.success(`Pulled from the handbook (version ${done.version})`);
      onOpenChange(false);
      router.refresh();
    });
  }

  const canTake = preview?.state === "repo_ahead" || preview?.state === "both_changed";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review &amp; pull from the handbook</DialogTitle>
          <DialogDescription>
            {preview ? `${preview.path} on the handbook's main branch.` : "Reading the handbook…"}
          </DialogDescription>
        </DialogHeader>
        <div aria-live="polite" className="flex flex-col gap-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading the diff…</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {preview ? (
            <>
              <p
                role={preview.state === "both_changed" ? "alert" : undefined}
                className={
                  preview.state === "both_changed"
                    ? "rounded-md border border-amber-600/40 bg-amber-500/10 p-2 text-sm"
                    : "text-sm"
                }
              >
                {MESSAGES[preview.state]}
              </p>
              {preview.diff.length > 0 ? (
                <LineDiffView
                  hunks={preview.diff}
                  label={`Changes to ${preview.path}`}
                  oldLabel="HQ"
                  newLabel="handbook"
                  className="max-h-80 overflow-y-auto"
                />
              ) : null}
            </>
          ) : null}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Close
            </Button>
          </DialogClose>
          {preview?.state === "both_changed" ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                onKeepHq();
              }}
            >
              Keep HQ version
            </Button>
          ) : null}
          {canTake ? (
            <Button type="button" disabled={applying} onClick={take}>
              {applying
                ? "Pulling…"
                : preview?.state === "both_changed"
                  ? "Take handbook version"
                  : "Pull handbook version"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
