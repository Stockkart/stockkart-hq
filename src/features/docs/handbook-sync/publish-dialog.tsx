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

import { LineDiffView } from "../diff/line-diff-view";

import { PublicRepoWarning } from "./public-repo-warning";

export const SAVE_FIRST_MESSAGE =
  "Save first: your latest changes are not saved yet, and only the saved version is published.";

/**
 * DOC-14 "Publish to handbook" for one doc: path editor (validated), the Markdown that would
 * be committed, the diff against the repo file when it exists, the public-repo warning and
 * the secret-scan block (no override). Opening it asks GitHub through a server action; the
 * page itself never does. The server exports the doc's SAVED version only; `prepare` (the
 * doc page's flush) saves pending edits before the preview, and a save that did not land
 * blocks the dialog with "Save first".
 */
export function PublishDialog({
  open,
  onOpenChange,
  projectKey,
  docId,
  initialPath,
  prepare,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectKey: string;
  docId: string;
  initialPath: string;
  /** Saves pending edits; false if they could not all be saved. */
  prepare?: () => Promise<boolean>;
}) {
  const router = useRouter();
  const ids = { path: useId(), error: useId(), ack: useId(), overwrite: useId(), special: useId() };
  const [path, setPath] = useState(initialPath);
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [special, setSpecial] = useState(false);
  const [loading, startLoading] = useTransition();
  const [publishing, startPublishing] = useTransition();

  /** `nextPath` undefined: the doc's own path, as the server resolves it now (adopted). */
  function request(nextPath: string | undefined) {
    startLoading(async () => {
      setError(null);
      try {
        const result = await handbookPublishPreviewAction({ docId, path: nextPath });
        if (result.ok) {
          setPreview(result.data);
          // The default path follows the SAVED title (a rename in edit mode included).
          if (nextPath === undefined) setPath(result.data.path);
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
    if (unsaved) return;
    const parsed = handbookPathInput.safeParse(nextPath);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid path");
      return;
    }
    request(parsed.data);
  }

  // Mounted per opening (see the doc actions), so this runs once per dialog: pending edits
  // are saved first, so the preview (and the publish) is of what the person sees.
  useEffect(() => {
    if (!prepare) {
      request(undefined);
      return;
    }
    startLoading(async () => {
      if (await prepare()) {
        request(undefined);
      } else {
        setUnsaved(true);
        setError(SAVE_FIRST_MESSAGE);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stale = preview !== null && preview.path !== path.trim();
  const blocked =
    unsaved ||
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
          // Only the version this preview showed may be published (see the schema).
          expectedVersion: preview.version,
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
          <Button type="submit" variant="outline" disabled={loading || unsaved}>
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
              <LineDiffView
                hunks={preview.remote.diff}
                label={`Changes to ${preview.path}`}
                oldLabel="handbook"
                newLabel="HQ"
                scrollable
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
