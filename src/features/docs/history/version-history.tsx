"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RichTextView } from "@/features/editor/rich-text-view";
import { callAction, RelativeTime } from "@/features/issue/client-utils";
import { type DocVersionDetail, type DocVersionView } from "@/lib/docs/views";
import { emptyDoc, type RichTextDoc } from "@/lib/rich-text";
import { cn } from "@/lib/utils";
import { loadDocVersionAction } from "@/server/actions/docs";

import { VersionDiff } from "./version-diff";

/**
 * DOC-10 History panel: the kept versions (number, author, time, "current"). Opening one
 * shows its diff against the current version (or, with the toggle, against the version
 * before it) and a read-only preview, and offers "Restore this version" after a
 * confirmation. Version contents are loaded when opened, never with the page.
 */

export type RestoreOutcome = "restored" | "conflict" | "failed";

export interface CurrentDoc {
  version: number;
  title: string;
  content: RichTextDoc | null;
}

/** Markdown of a version for the diff: its title as `# …`, then the body (export rules). */
async function markdownOf(
  doc: { title: string; content: RichTextDoc | null },
  projectKey: string,
): Promise<string> {
  // The serializer (markdown-it) loads only when a diff is opened.
  const { richTextToMarkdown } = await import("@/lib/markdown/from-rich-text");
  return `# ${doc.title}\n\n${richTextToMarkdown(doc.content ?? emptyDoc(), { projectKey })}`;
}

export function HistoryPanel({
  docId,
  projectKey,
  versions,
  current,
  onRestore,
}: {
  docId: string;
  projectKey: string;
  versions: DocVersionView[];
  /** The latest saved state (the editor's while editing). */
  current: () => CurrentDoc;
  /**
   * Restores `version`. `conflict`: someone saved meanwhile; the dialog closes so the page's
   * conflict banner is seen. `failed`: refused (a toast says why); the dialog stays.
   */
  onRestore: (version: number) => Promise<RestoreOutcome>;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const currentVersion = current().version;
  return (
    <section aria-label="History" className="flex flex-col gap-2">
      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No versions yet.</p>
      ) : (
        <ol className="flex flex-col gap-0.5 text-sm">
          {versions.map((version) => (
            <li key={version.version}>
              <button
                type="button"
                onClick={() => setOpen(version.version)}
                className="flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="font-mono text-xs">v{version.version}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {version.authorName ?? "Import"}
                </span>
                {version.version === currentVersion ? (
                  <span className="rounded bg-muted px-1 text-[10px] font-medium uppercase">
                    current
                  </span>
                ) : null}
                <span className="shrink-0 text-xs text-muted-foreground">
                  <RelativeTime date={version.createdAt} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">
        Kept on “Save version”, on a restore and at most every 10 minutes while editing.
        {versions.some((version) => version.version === currentVersion)
          ? ""
          : ` The current version (v${currentVersion}) is newer than the last one kept.`}
      </p>
      {open !== null ? (
        <VersionDialog
          docId={docId}
          projectKey={projectKey}
          version={open}
          previous={versions.find((version) => version.version < open)?.version ?? null}
          current={current}
          onRestore={onRestore}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}

/** Loaded version contents, shared by every dialog of the page (they never change). */
const loaded = new Map<string, DocVersionDetail>();

function useVersion(docId: string, version: number | null): DocVersionDetail | null {
  const key = version === null ? null : `${docId}:${version}`;
  const [, setLoadedCount] = useState(0);
  useEffect(() => {
    if (key === null || version === null || loaded.has(key)) return;
    let cancelled = false;
    void callAction(() => loadDocVersionAction({ docId, version })).then((detail) => {
      if (!detail) return;
      loaded.set(key, detail);
      // Re-render with the loaded copy.
      if (!cancelled) setLoadedCount((count) => count + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [docId, version, key]);
  return key === null ? null : (loaded.get(key) ?? null);
}

function VersionDialog({
  docId,
  projectKey,
  version,
  previous,
  current,
  onRestore,
  onClose,
}: {
  docId: string;
  projectKey: string;
  version: number;
  previous: number | null;
  current: () => CurrentDoc;
  onRestore: (version: number) => Promise<RestoreOutcome>;
  onClose: () => void;
}) {
  // The current copy as of opening: a save while the dialog is open is not chased.
  const [now] = useState(current);
  const isCurrent = version === now.version;
  // The current version has nothing to compare against itself: show what it changed.
  const [withPrevious, setWithPrevious] = useState(isCurrent && previous !== null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, startRestore] = useTransition();
  const toggleId = useId();
  const detail = useVersion(docId, version);
  const before = useVersion(docId, withPrevious ? previous : null);
  const [texts, setTexts] = useState<{ key: string; old: string; new: string } | null>(null);

  const pairKey = withPrevious ? `v${previous}→v${version}` : `v${version}→current`;
  useEffect(() => {
    if (!detail || (withPrevious && !before)) return;
    let cancelled = false;
    const from = withPrevious && before ? before : detail;
    const to = withPrevious ? detail : now;
    void Promise.all([markdownOf(from, projectKey), markdownOf(to, projectKey)]).then(
      ([oldText, newText]) => {
        if (!cancelled) setTexts({ key: pairKey, old: oldText, new: newText });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [detail, before, withPrevious, projectKey, pairKey, now]);

  const labels = withPrevious
    ? { old: `v${previous}`, new: `v${version}` }
    : { old: `v${version}`, new: `the current version (v${now.version})` };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            Version {version}
            {isCurrent ? " (current)" : ""}
          </DialogTitle>
          <DialogDescription>
            {detail ? (
              <>
                {detail.authorName ?? "Import"} · <RelativeTime date={detail.createdAt} />
              </>
            ) : (
              "Loading…"
            )}
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="changes">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="changes">Changes</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
            <label htmlFor={toggleId} className="flex items-center gap-2 text-sm">
              <input
                id={toggleId}
                type="checkbox"
                checked={withPrevious}
                disabled={previous === null}
                onChange={(event) => setWithPrevious(event.target.checked)}
              />
              Compare with previous version
            </label>
          </div>
          <TabsContent value="changes" className="max-h-[50dvh] overflow-y-auto">
            {texts && texts.key === pairKey ? (
              <VersionDiff
                // A new pair starts with its unchanged runs collapsed again.
                key={pairKey}
                oldText={texts.old}
                newText={texts.new}
                oldLabel={labels.old}
                newLabel={labels.new}
              />
            ) : (
              <p className="text-sm text-muted-foreground" role="status">
                Loading the changes…
              </p>
            )}
          </TabsContent>
          <TabsContent value="preview" className="max-h-[50dvh] overflow-y-auto">
            {detail ? (
              <article aria-label={`Version ${version}, read-only`} className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold">{detail.title}</h2>
                <RichTextView
                  doc={detail.content}
                  projectKeys={[projectKey]}
                  empty={<p className="text-sm text-muted-foreground">Empty.</p>}
                />
              </article>
            ) : (
              <p className="text-sm text-muted-foreground" role="status">
                Loading…
              </p>
            )}
          </TabsContent>
        </Tabs>
        {isCurrent ? null : (
          <div
            className={cn(
              "flex flex-wrap items-center justify-end gap-2 border-t pt-3",
              confirming && "justify-between",
            )}
          >
            {confirming ? (
              <>
                <p className="text-sm" role="alert">
                  Restore v{version}? This saves its title and content as a new version (v
                  {now.version + 1}); nothing in the history is lost.
                </p>
                <span className="flex gap-2">
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={restoring}
                    onClick={() =>
                      startRestore(async () => {
                        const outcome = await onRestore(version);
                        if (outcome === "failed") setConfirming(false);
                        else onClose();
                      })
                    }
                  >
                    {restoring ? "Restoring…" : `Restore v${version}`}
                  </Button>
                </span>
              </>
            ) : (
              <Button variant="outline" disabled={!detail} onClick={() => setConfirming(true)}>
                <RotateCcw aria-hidden="true" />
                Restore this version
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
