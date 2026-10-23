"use client";

import { Copy, RefreshCw, Save, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { matchesQuery, Select } from "@/components/ui/select";
import { LazyRichTextEditor } from "@/features/editor/lazy-rich-text-editor";
import { callAction } from "@/features/issue/client-utils";
import { userOptions } from "@/features/issue/field-options";
import { hasPendingUploads, withoutPendingUploads } from "@/lib/attachments/nodes";
import { anchorIdsInOrder } from "@/lib/doc-comments/anchors";
import { splitAdrTitle } from "@/lib/docs/adr";
import {
  ADR_STATUS_LABELS,
  ADR_STATUSES,
  type AdrStatus,
  DOC_STATUS_LABELS,
  DOC_STATUSES,
  DOC_TYPE_LABELS,
  type DocStatus,
  type DocType,
  PICKABLE_DOC_TYPES,
} from "@/lib/docs/constants";
import { DOC_TITLE_MAX } from "@/lib/docs/schemas";
import { type DocDetail, type DocRef } from "@/lib/docs/views";
import { extractIssueRefs } from "@/lib/issues/keys";
import { type UserOption } from "@/lib/issues/views";
import { emptyDoc, extractPlainText, type RichTextDoc } from "@/lib/rich-text";
import { cn } from "@/lib/utils";
import { saveDocAction, updateDocMetaAction } from "@/server/actions/docs";

import {
  type ConflictInfo,
  DocAutosaver,
  type SaveRequest,
  type SaveResponse,
  type SaverState,
} from "./autosaver";
import { LazyDraftBanner } from "./draft-banner";
import { clearDraft, type DocDraft, saveDraft } from "./draft-store";

export interface DocEditorProps {
  doc: DocDetail;
  projectKeys: string[];
  users: UserOption[];
  /** Other ADRs of the project, for "Superseded by" (ADR-2). */
  adrs: DocRef[];
  /** The page's handle on the autosaver ("Done", "Save version"). */
  controllerRef?: Ref<DocEditorController>;
  /** Every autosave state change (the page header shows "Saved · vN"). */
  onSaverState?: (state: SaverState) => void;
  /** DOC-13: the anchors of the current content changed (orders the comment threads). */
  onAnchorOrder?: (order: string[]) => void;
}

/** Issue references that count as mentions; a change means the Linked issues panel changed. */
function refsKey(content: RichTextDoc, projectKeys: readonly string[]): string {
  return extractIssueRefs(extractPlainText(content, { skipCode: true }), projectKeys)
    .map((ref) => `${ref.projectKey}-${ref.number}`)
    .join(",");
}

/** Keeps the anchor list's identity while it is unchanged (no re-render per keystroke). */
function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function saveRequest(docId: string, request: SaveRequest): Promise<SaveResponse> {
  let result;
  try {
    result = await saveDocAction({ docId, ...request });
  } catch {
    // Thrown (not returned) failures include an ended session; details stay server-side.
    return { status: "failed", message: "Could not save. Reload the page and try again." };
  }
  if (!result.ok) return { status: "failed", message: result.error };
  const data = result.data;
  if (data.status === "saved") {
    return { status: "saved", version: data.version, snapshotted: data.snapshotted };
  }
  return { status: "conflict", latest: data.latest };
}

/** "Saved · vN" and friends; shared with the diagram editor (DGM-4). */
export function SaveIndicator({
  state,
  onRetry,
}: {
  state: SaverState<unknown>;
  onRetry: () => void;
}) {
  const text: Record<SaverState["status"], string> = {
    saved: `Saved · v${state.version}`,
    dirty: "Unsaved changes",
    saving: "Saving…",
    conflict: "Not saved: conflict",
    error: "Not saved",
  };
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <span
        role="status"
        aria-live="polite"
        className={cn(state.status === "error" && "text-destructive")}
      >
        {text[state.status]}
      </span>
      {state.status === "error" ? (
        <button type="button" className="underline underline-offset-2" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </span>
  );
}

export function ConflictBanner({
  conflict,
  onReload,
  onKeepMine,
  onCopyMine,
  message,
  keepMineLabel = "Keep mine (overwrite)",
}: {
  /** Docs and diagrams (DGM-4) share the banner; only these fields are shown. */
  conflict: ConflictInfo<unknown>;
  onReload: () => void;
  onKeepMine: () => void;
  onCopyMine: () => void;
  /** Replaces the default "… while you were editing" text (e.g. a DOC-10 restore). */
  message?: ReactNode;
  keepMineLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
    >
      <TriangleAlert aria-hidden="true" className="size-4 text-amber-600" />
      <span className="flex-1">
        {message ?? (
          <>
            Updated by {conflict.updatedByName ?? "someone else"} (v{conflict.version}) while you
            were editing. Your changes are not saved yet.
          </>
        )}
      </span>
      <span className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onReload}>
          <RefreshCw aria-hidden="true" />
          Reload
        </Button>
        <Button size="sm" variant="outline" onClick={onKeepMine}>
          <Save aria-hidden="true" />
          {keepMineLabel}
        </Button>
        <Button size="sm" variant="outline" onClick={onCopyMine}>
          <Copy aria-hidden="true" />
          Copy mine
        </Button>
      </span>
    </div>
  );
}

/** What the doc page drives in edit mode ("Done", "Save version", Retry, Copy). */
export interface DocEditorController {
  /** Saves everything pending; resolves with the final state (see `Autosaver.flush`). */
  flush: () => Promise<SaverState>;
  /** "Save version": save now and keep a snapshot. */
  saveVersion: () => void;
  retry: () => void;
  /** My current copy (title with any ADR prefix, content). */
  mine: () => { title: string; content: RichTextDoc };
  /** An image or file is still uploading (it lands in the editor, so do not leave yet). */
  uploading: () => boolean;
}

/**
 * §5.5 edit mode of a doc: the conflict and draft banners, the editable title, the
 * metadata pickers and the autosaving body (§7.4). The doc page (`doc-screen.tsx`) owns the
 * header, the side panel and the read mode; it drives this through `controllerRef`.
 */
export function DocEditor({
  doc,
  projectKeys,
  users,
  adrs,
  controllerRef,
  onSaverState,
  onAnchorOrder,
}: DocEditorProps) {
  const router = useRouter();
  const isAdr = doc.type === "adr";
  const adrParts = isAdr ? splitAdrTitle(doc.title) : null;
  // ADR titles keep their "NNNN. " prefix; only the rest is editable.
  const prefix = adrParts ? doc.title.slice(0, doc.title.length - adrParts.title.length) : "";
  const [titleText, setTitleText] = useState(adrParts ? adrParts.title : doc.title);
  const [editorKey, setEditorKey] = useState(0);
  const [editorContent, setEditorContent] = useState<RichTextDoc | null>(doc.content);
  const [state, setState] = useState<SaverState>({
    status: "saved",
    version: doc.version,
    conflict: null,
    error: null,
  });
  const ids = {
    title: useId(),
    type: useId(),
    status: useId(),
    owner: useId(),
    adr: useId(),
    successor: useId(),
  };
  // DOC-13: where the comment anchors are in the CURRENT content (orders threads, finds
  // orphans the moment their text is deleted). Reported to the page's comments panel.
  const anchorOrder = useRef(anchorIdsInOrder(doc.content));
  // The editor's content with upload placeholders (the saver gets it without them).
  const rawContent = useRef<RichTextDoc | null>(doc.content);
  const reportAnchors = (content: RichTextDoc | null) => {
    const order = anchorIdsInOrder(content);
    if (sameOrder(anchorOrder.current, order)) return;
    anchorOrder.current = order;
    onAnchorOrder?.(order);
  };
  // The page header shows the save state ("Saved · vN").
  useEffect(() => {
    onSaverState?.(state);
  }, [state, onSaverState]);

  // Created once per doc; it owns the version and the pending content from here on.
  const [saver] = useState(() => {
    // Mention refs as of the last save, to tell when Linked issues changed.
    let lastRefs = refsKey(doc.content ?? emptyDoc(), projectKeys);
    return new DocAutosaver(
      { version: doc.version, content: doc.content ?? emptyDoc(), title: doc.title },
      {
        save: (request) => saveRequest(doc.id, request),
        onState: setState,
        onSaved: ({ titleChanged, snapshotted, content }) => {
          clearDraft(doc.id);
          const refs = refsKey(content, projectKeys);
          const refsChanged = refs !== lastRefs;
          lastRefs = refs;
          // Tree/breadcrumb, Linked issues or the version list changed: re-render the page.
          if (titleChanged || refsChanged || snapshotted) router.refresh();
        },
      },
    );
  });

  useImperativeHandle(
    controllerRef,
    () => ({
      flush: () => saver.flush(),
      saveVersion: () => saver.saveNow(true),
      retry: () => saver.saveNow(),
      mine: () => saver.mine,
      uploading: () => hasPendingUploads(rawContent.current),
    }),
    [saver],
  );

  useEffect(() => {
    // Keep my copy in this tab if it could not be saved, so leaving never loses it.
    const stash = () => {
      if (saver.hasUnsavedChanges) saveDraft(doc.id, saver.mine);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!saver.hasUnsavedChanges) return;
      stash();
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Leaving the page (client navigation) or edit mode: stash, save what is pending,
      // then stop. A successful save clears the stash again (onSaved).
      stash();
      saver.saveNow();
      saver.dispose();
    };
  }, [saver, doc.id]);

  // A refresh brought a newer version (e.g. renamed from the tree). Continue from it only
  // if it holds exactly my content; otherwise the next save reports the conflict.
  const [seenVersion, setSeenVersion] = useState(doc.version);
  if (seenVersion !== doc.version) {
    setSeenVersion(doc.version);
    const adopted = saver.rebase(doc);
    if (adopted !== null) {
      const parts = isAdr ? splitAdrTitle(adopted) : null;
      setTitleText(parts ? parts.title : adopted);
    }
  }

  function restoreDraft(draft: DocDraft) {
    const parts = isAdr ? splitAdrTitle(draft.title) : null;
    setTitleText(parts ? parts.title : draft.title);
    setEditorContent(draft.content);
    reportAnchors(draft.content);
    setEditorKey((key) => key + 1);
    // Saved like any edit: against the current version, so a newer save still conflicts.
    saver.change({ content: draft.content, title: draft.title });
  }

  function reload() {
    const latest = saver.reload();
    if (!latest) return;
    const parts = isAdr ? splitAdrTitle(latest.title) : null;
    setTitleText(parts ? parts.title : latest.title);
    setEditorContent(latest.content);
    reportAnchors(latest.content);
    // A new key remounts the editor with the winner's content.
    setEditorKey((key) => key + 1);
    router.refresh();
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {state.conflict ? (
        <ConflictBanner
          conflict={state.conflict}
          onReload={reload}
          onKeepMine={() => saver.keepMine()}
          onCopyMine={() => void copyText(saver.mine)}
        />
      ) : null}

      <LazyDraftBanner
        docId={doc.id}
        current={{ title: doc.title, content: doc.content }}
        onRestore={restoreDraft}
      />

      <div className="flex items-baseline gap-1">
        {prefix ? (
          <span className="font-mono text-2xl font-semibold text-muted-foreground">
            {prefix.trim()}
          </span>
        ) : null}
        <label htmlFor={ids.title} className="sr-only">
          Title
        </label>
        <input
          id={ids.title}
          value={titleText}
          maxLength={DOC_TITLE_MAX - prefix.length}
          onChange={(event) => {
            setTitleText(event.target.value);
            const next = event.target.value.replace(/\s+/g, " ").trim();
            // An empty title is not saved; the last saved one stays until it is filled in.
            if (next) saver.change({ title: `${prefix}${next}` });
          }}
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 text-2xl font-semibold outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      <DocMetaControls doc={doc} users={users} adrs={adrs} ids={ids} />

      <LazyRichTextEditor
        key={editorKey}
        variant="doc"
        initialContent={editorContent}
        projectKeys={projectKeys}
        label="Document"
        placeholder="Write the doc. Mention issues as STK-123."
        className="min-h-[60vh]"
        // An upload placeholder is never saved; the finished image triggers its own change.
        onChange={(content) => {
          rawContent.current = content;
          saver.change({ content: withoutPendingUploads(content) });
          reportAnchors(content);
        }}
      />
    </div>
  );
}

/** "Copy mine" of the conflict banner: the title and the plain text. */
async function copyText(mine: { title: string; content: RichTextDoc }) {
  const text = `${mine.title}\n\n${extractPlainText(mine.content)}`;
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Your version is on the clipboard");
  } catch {
    toast.error("Could not copy. Select the text in the editor and copy it instead.");
  }
}

/** DOC-3/DOC-4 type, status, owner; ADR-2 status and "Superseded by". Last write wins. */
function DocMetaControls({
  doc,
  users,
  adrs,
  ids,
}: {
  doc: DocDetail;
  users: UserOption[];
  adrs: DocRef[];
  ids: Record<"type" | "status" | "owner" | "adr" | "successor", string>;
}) {
  const [type, setType] = useState<DocType>(doc.type);
  const [status, setStatus] = useState<DocStatus>(doc.status);
  const [ownerId, setOwnerId] = useState<string | null>(doc.ownerId);
  const [adrStatus, setAdrStatus] = useState<AdrStatus>(doc.adrStatus ?? "proposed");
  const [successor, setSuccessor] = useState<string | null>(doc.adrSupersededBy?.id ?? null);
  const isAdr = doc.type === "adr";

  /** Optimistic: show the value now, put the old one back if the server refuses. */
  async function update<T>(
    set: (value: T) => void,
    previous: T,
    next: T,
    send: () => ReturnType<typeof updateDocMetaAction>,
  ) {
    set(next);
    const result = await callAction(send);
    if (result === null) set(previous);
  }

  const labelClass = "text-xs text-muted-foreground";
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        {isAdr ? (
          <>
            <span className={labelClass}>Type</span>
            <span className="flex h-8 items-center text-sm">ADR</span>
          </>
        ) : (
          <>
            <label htmlFor={ids.type} className={labelClass}>
              Type
            </label>
            <Select
              id={ids.type}
              label="Type"
              className="w-40"
              value={type}
              options={PICKABLE_DOC_TYPES.map((value) => ({
                value,
                label: DOC_TYPE_LABELS[value],
              }))}
              onChange={(next) => {
                if (next)
                  void update(setType, type, next, () =>
                    updateDocMetaAction({ docId: doc.id, field: "type", value: next }),
                  );
              }}
            />
          </>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.status} className={labelClass}>
          Doc status
        </label>
        <Select
          id={ids.status}
          label="Doc status"
          className="w-36"
          value={status}
          options={DOC_STATUSES.map((value) => ({ value, label: DOC_STATUS_LABELS[value] }))}
          onChange={(next) => {
            if (next)
              void update(setStatus, status, next, () =>
                updateDocMetaAction({ docId: doc.id, field: "status", value: next }),
              );
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.owner} className={labelClass}>
          Owner
        </label>
        <Select
          id={ids.owner}
          label="Owner"
          className="w-44"
          value={ownerId}
          options={userOptions(users)}
          clearLabel="No owner"
          onChange={(next) => {
            void update(setOwnerId, ownerId, next, () =>
              updateDocMetaAction({ docId: doc.id, field: "owner", value: next }),
            );
          }}
        />
      </div>
      {isAdr ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.adr} className={labelClass}>
              ADR status
            </label>
            <Select
              id={ids.adr}
              label="ADR status"
              className="w-36"
              value={adrStatus}
              options={ADR_STATUSES.map((value) => ({ value, label: ADR_STATUS_LABELS[value] }))}
              onChange={(next) => {
                if (!next) return;
                // "Superseded" needs a target first; it is saved once one is chosen.
                if (next === "superseded" && !successor) {
                  setAdrStatus(next);
                  return;
                }
                void update(setAdrStatus, adrStatus, next, () =>
                  updateDocMetaAction({
                    docId: doc.id,
                    field: "adrStatus",
                    value: next,
                    supersededBy: next === "superseded" ? successor : null,
                  }),
                );
              }}
            />
          </div>
          {adrStatus === "superseded" ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.successor} className={labelClass}>
                Superseded by
              </label>
              <Combobox
                id={ids.successor}
                label="Superseded by"
                className="w-64"
                value={successor}
                valueLabel={adrs.find((adr) => adr.id === successor)?.title ?? null}
                placeholder="Choose an ADR…"
                searchPlaceholder="Number or title…"
                emptyText="No matching ADR"
                // The project's ADRs came with the page: filtering needs no request.
                loadOptions={async (query) =>
                  adrs
                    .map((adr) => ({ value: adr.id, label: adr.title }))
                    .filter((option) => matchesQuery(option, query))
                }
                onChange={(next) => {
                  if (!next) return;
                  void update(setSuccessor, successor, next, () =>
                    updateDocMetaAction({
                      docId: doc.id,
                      field: "adrStatus",
                      value: "superseded",
                      supersededBy: next,
                    }),
                  );
                }}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
