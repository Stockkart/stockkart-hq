"use client";

import { Download, File, FileText, ImageIcon, Paperclip, Trash2, Upload } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { callAction, RelativeTime } from "@/features/issue/client-utils";
import { attachmentUrl } from "@/lib/attachments/nodes";
import { type AttachmentView, attachmentCategory, formatBytes } from "@/lib/attachments/views";
import { cn } from "@/lib/utils";
import { deleteAttachmentAction } from "@/server/actions/attachments";
import { STORAGE_NOT_CONFIGURED_MESSAGE } from "@/server/storage/errors";

import { type UploadFile, uploadFile, type UploadTarget } from "./upload-client";

/**
 * ISS-9 attachments panel of an issue or a doc: every ready file with a thumbnail or icon,
 * name, size, uploader and time; download; delete (soft, uploader only, optimistic with
 * rollback); a drop zone plus an "Attach files" button (the keyboard alternative to drag
 * and drop). Comment files are not listed here: they show inline in their comment.
 */

/** Larger images get an icon: a 40 px thumbnail should not pull a 10 MB original. */
const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

interface Uploading {
  key: string;
  filename: string;
  progress: number;
}

export function AttachmentsPanel({
  target,
  attachments,
  currentUserId,
  storageReady,
  upload = uploadFile,
}: {
  target: UploadTarget;
  attachments: AttachmentView[];
  currentUserId: string;
  storageReady: boolean;
  /** Injectable for tests. */
  upload?: UploadFile;
}) {
  const headingId = useId();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState<AttachmentView[]>([]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("");
  const [, startTransition] = useTransition();

  // Server rows first; files added here appear until the refreshed page brings them.
  const serverIds = new Set(attachments.map((item) => item.id));
  const items = [...attachments, ...added.filter((item) => !serverIds.has(item.id))].filter(
    (item) => !hidden.has(item.id),
  );

  function uploadAll(files: readonly File[]) {
    if (files.length === 0) return;
    if (!storageReady) {
      toast.error(STORAGE_NOT_CONFIGURED_MESSAGE);
      return;
    }
    for (const file of files) {
      const key = `${Date.now()}-${Math.random()}`;
      setUploading((list) => [...list, { key, filename: file.name, progress: 0 }]);
      void upload(file, target, {
        onProgress: (progress) =>
          setUploading((list) =>
            list.map((item) => (item.key === key ? { ...item, progress } : item)),
          ),
      }).then((result) => {
        setUploading((list) => list.filter((item) => item.key !== key));
        if (result.ok) {
          setAdded((list) => [...list, result.data]);
          setStatus(`${result.data.filename} attached`);
        } else {
          toast.error(result.error);
        }
      });
    }
  }

  function remove(item: AttachmentView) {
    if (!window.confirm(`Delete ${item.filename}?`)) return;
    // Optimistic: hide now, bring it back if the server refuses.
    setHidden((set) => new Set(set).add(item.id));
    startTransition(async () => {
      const result = await callAction(() => deleteAttachmentAction({ attachmentId: item.id }));
      if (result === null) {
        setHidden((set) => {
          const next = new Set(set);
          next.delete(item.id);
          return next;
        });
        return;
      }
      setStatus(`${item.filename} deleted`);
    });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 id={headingId} className="flex items-center gap-1.5 text-sm font-semibold">
          <Paperclip aria-hidden="true" className="size-4" />
          Attachments{items.length > 0 ? ` (${items.length})` : ""}
        </h2>
        {storageReady ? (
          <>
            <label htmlFor={inputId} className="sr-only">
              Attach files
            </label>
            <input
              ref={input}
              id={inputId}
              type="file"
              multiple
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                uploadAll(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <Button variant="ghost" size="sm" onClick={() => input.current?.click()}>
              <Upload aria-hidden="true" />
              Attach files
            </Button>
          </>
        ) : null}
      </div>

      {storageReady ? (
        <div
          data-testid="attachments-drop-zone"
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            uploadAll(Array.from(event.dataTransfer.files));
          }}
          className={cn(
            "rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground",
            dragging && "border-ring bg-accent/40",
          )}
        >
          Drop files here, or use “Attach files”. Up to 10 MB each.
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{STORAGE_NOT_CONFIGURED_MESSAGE}</p>
      )}

      {uploading.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="Uploads in progress">
          {uploading.map((item) => (
            <li key={item.key} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{item.filename}</span>
              <progress
                max={100}
                value={Math.round(item.progress * 100)}
                aria-label={`Uploading ${item.filename}`}
                className="h-1.5 w-24"
              />
            </li>
          ))}
        </ul>
      ) : null}

      {items.length === 0 ? (
        storageReady ? (
          <p className="text-sm text-muted-foreground">No attachments yet.</p>
        ) : null
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {items.map((item) => (
            <AttachmentRow
              key={item.id}
              item={item}
              own={item.uploadedBy === currentUserId}
              onDelete={() => remove(item)}
            />
          ))}
        </ul>
      )}
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </section>
  );
}

function AttachmentRow({
  item,
  own,
  onDelete,
}: {
  item: AttachmentView;
  own: boolean;
  onDelete: () => void;
}) {
  const category = attachmentCategory(item);
  const Icon =
    category === "image" ? ImageIcon : category === "pdf" || category === "text" ? FileText : File;
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      {category === "image" && item.sizeBytes <= THUMBNAIL_MAX_BYTES ? (
        // Thumbnail through the authed route; reserved box, lazy (no layout shift).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachmentUrl(item.id)}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          className="size-10 shrink-0 rounded border object-cover"
        />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded border bg-muted">
          <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <a
          href={attachmentUrl(item.id, { download: true })}
          className="truncate font-medium underline-offset-2 hover:underline"
        >
          {item.filename}
        </a>
        <span className="text-xs text-muted-foreground">
          {formatBytes(item.sizeBytes)} · {item.uploaderName ?? "Former user"} ·{" "}
          <RelativeTime date={new Date(item.createdAt)} />
        </span>
      </div>
      <a
        href={attachmentUrl(item.id, { download: true })}
        aria-label={`Download ${item.filename}`}
        title="Download"
        className="rounded p-1.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Download aria-hidden="true" className="size-4" />
      </a>
      {own ? (
        <button
          type="button"
          aria-label={`Delete ${item.filename}`}
          title="Delete"
          onClick={onDelete}
          className="rounded p-1.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </li>
  );
}
