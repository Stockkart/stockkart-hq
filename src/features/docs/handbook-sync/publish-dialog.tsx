"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
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
import { GIT_NULL_SHA } from "@/lib/handbook/constants";
import { handbookPathInput } from "@/lib/handbook/schemas";
import { type PublishPreview } from "@/lib/handbook/views";
import { handbookPublishAction, handbookPublishPreviewAction } from "@/server/actions/handbook";

import { DiffView, PublicRepoWarning } from "./diff-view";

/**
 * DOC-14 "Publish to handbook" for one doc: path editor (validated), the Markdown that would
 * be committed, the diff against the repo file when it exists, the public-repo warning and
 * the secret-scan block (no override). Opening it asks GitHub through a server action; the
 * page itself never does.
 */
export function PublishDialog({
  open,
  onOpenChange,
  projectKey,
  docId,
  initialPath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectKey: string;
  docId: string;
  initialPath: string;
}) {
  const router = useRouter();
  const ids = { path: useId(), error: useId(), ack: useId(), overwrite: useId(), special: useId() };
  const [path, setPath] = useState(initialPath);
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [special, setSpecial] = useState(false);
  const [loading, startLoading] = useTransition();
  const [publishing, startPublishing] = useTransition();

  function request(nextPath: string) {
    startLoading(async () => {
      setError(null);
      try {
        const result = await handbookPublishPreviewAction({ docId, path: nextPath });
        if (result.ok) {
          setPreview(result.data);
          setOverwrite(false);
          setSpecial(false);
          // A new preview needs a new look at the content.
          setAcknowledged(false);
        } else {
          setPreview(null);
          setError(result.error);
        }
      } catch {
        setError("Something went wrong. Reload the page and try again.");
      }
    });
  }

  function load(nextPath: string) {
    const parsed = handbookPathInput.safeParse(nextPath);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid path");
      return;
    }
    request(parsed.data);
  }

  // Mounted per opening (see HandbookActions), so this runs once per dialog.
  useEffect(() => {
    request(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stale = preview !== null && preview.path !== path.trim();
  const blocked =
    !preview ||
    stale ||
    preview.secret !== null ||
    preview.unchanged ||
    !acknowledged ||
    (preview.needsOverwrite && !overwrite) ||
    (preview.specialPath && !special);

  function publish() {
    if (!preview || blocked) return;
    startPublishing(async () => {
      const outcome = await callAction(() =>
        handbookPublishAction({
          projectKey,
          docIds: [docId],
          path: preview.path,
          overwrite: preview.needsOverwrite
            ? [{ docId, remoteSha: preview.remote?.sha ?? GIT_NULL_SHA }]
            : [],
          acknowledgedPublic: acknowledged,
          confirmSpecialPath: preview.specialPath && special,
        }),
      );
      if (!outcome) return;
      if (outcome.pr) toast.success(`Opened PR #${outcome.pr.number} on the handbook`);
      else if (outcome.unchanged.length > 0) toast.success("Already the same as the handbook");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Publish to handbook</DialogTitle>
          <DialogDescription>
            Opens a pull request on the handbook repo with this doc. Nothing is pushed to the main
            branch.
          </DialogDescription>
        </DialogHeader>
        <PublicRepoWarning />
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            load(path);
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={ids.path} className="text-sm font-medium">
              Path in the repo
            </label>
            <Input
              id={ids.path}
              value={path}
              maxLength={200}
              aria-describedby={ids.error}
              aria-invalid={error !== null}
              onChange={(event) => setPath(event.target.value)}
            />
          </div>
          <Button type="submit" variant="outline" disabled={loading}>
            {loading ? "Checking…" : "Check path"}
          </Button>
        </form>
        <p id={ids.error} aria-live="polite" className="text-sm text-destructive">
          {error ?? (stale ? "Check the new path before publishing." : "")}
        </p>

        {preview ? (
          <div className="flex flex-col gap-3">
            {preview.secret ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/50 p-2 text-sm text-destructive"
              >
                Publishing is blocked: {preview.secret}
              </p>
            ) : null}
            {preview.unchanged ? (
              <p className="text-sm text-muted-foreground">
                The handbook already has exactly this content; there is nothing to publish.
              </p>
            ) : null}
            {preview.remote ? (
              <DiffView
                hunks={preview.remote.diff}
                label={`Changes to ${preview.path}`}
                oldLabel="handbook"
                newLabel="HQ"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {preview.path} is a new file in the handbook.
              </p>
            )}
            <details className="rounded-md border p-2">
              <summary className="cursor-pointer text-sm font-medium">Markdown to publish</summary>
              <pre className="mt-2 max-h-80 overflow-auto font-mono text-xs whitespace-pre-wrap">
                {preview.markdown}
              </pre>
            </details>
            {preview.needsOverwrite ? (
              <label htmlFor={ids.overwrite} className="flex items-start gap-2 text-sm">
                <input
                  id={ids.overwrite}
                  type="checkbox"
                  className="mt-1"
                  checked={overwrite}
                  onChange={(event) => setOverwrite(event.target.checked)}
                />
                <span>
                  {preview.remote
                    ? "The handbook changed since the last sync. Overwrite its changes shown above with the HQ version (or cancel and use “Review & pull” first)."
                    : "The file was removed from the handbook since the last sync. Add it back with the HQ version."}
                </span>
              </label>
            ) : null}
            {preview.specialPath ? (
              <label htmlFor={ids.special} className="flex items-start gap-2 text-sm">
                <input
                  id={ids.special}
                  type="checkbox"
                  className="mt-1"
                  checked={special}
                  onChange={(event) => setSpecial(event.target.checked)}
                />
                <span>
                  {preview.path} has a special meaning on GitHub (or is the ADR template). Write it
                  anyway.
                </span>
              </label>
            ) : null}
            <label htmlFor={ids.ack} className="flex items-start gap-2 text-sm">
              <input
                id={ids.ack}
                type="checkbox"
                className="mt-1"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>I checked the content: it is fine for everyone on the internet to read.</span>
            </label>
          </div>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" disabled={blocked || publishing} onClick={publish}>
            {publishing ? "Opening PR…" : "Open pull request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
