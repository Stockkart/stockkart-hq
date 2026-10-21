"use client";

import { type Editor, Extension, type JSONContent, mergeAttributes, Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { useAttachmentUpload } from "@/features/attachments/upload-context";
import {
  attachmentUrl,
  FILE_NODE,
  fileNodeAttrs,
  IMAGE_NODE,
  imageNodeAttrs,
  MAX_ALT_LENGTH,
} from "@/lib/attachments/nodes";
import { formatBytes } from "@/lib/attachments/views";
import { cn } from "@/lib/utils";
import { STORAGE_NOT_CONFIGURED_MESSAGE } from "@/server/storage/errors";

import { queueFile, runUpload, subscribeUpload, uploadProgress } from "./attachment-uploads";

/**
 * ISS-9 attachments in the editor: paste or drop a file → an `attachmentUpload` placeholder
 * (with progress) → once uploaded, an `image` node `{ attachmentId, alt, width, height }` or a
 * `fileAttachment` chip `{ attachmentId, filename, size }`. Images load through the authed
 * `/api/files/<id>` route only (S-5). The upload target comes from `AttachmentUploadProvider`.
 */

export const UPLOAD_NODE = "attachmentUpload";

export const NO_TARGET_MESSAGE = "Save first, then attach files";

function stringAttr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function altFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return (dot > 0 ? filename.slice(0, dot) : filename).slice(0, MAX_ALT_LENGTH);
}

/** Inserts one placeholder per file at `position` (default: the selection). */
export function insertUploads(editor: Editor, files: readonly File[], position?: number): boolean {
  if (files.length === 0) return false;
  const nodes: JSONContent[] = files.map((file) => ({
    type: UPLOAD_NODE,
    attrs: {
      token: queueFile(file),
      filename: file.name || "file",
      image: file.type.startsWith("image/"),
    },
  }));
  const at = position ?? editor.state.selection.from;
  return editor.chain().focus().insertContentAt(at, nodes).run();
}

/** Replaces the placeholder with `token` by `content` (or removes it when null). */
function settlePlaceholder(editor: Editor, token: string, content: JSONContent | null): void {
  if (editor.isDestroyed) return;
  let range: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (range) return false;
    if (node.type.name === UPLOAD_NODE && node.attrs.token === token) {
      range = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  if (!range) return;
  if (content) editor.chain().insertContentAt(range, content).run();
  else editor.chain().deleteRange(range).run();
}

function UploadPlaceholderView({ node, editor }: ReactNodeViewProps) {
  const token = stringAttr(node.attrs.token);
  const filename = stringAttr(node.attrs.filename) || "file";
  const { target, storageReady, upload } = useAttachmentUpload();
  const progress = useSyncExternalStore(
    (listener) => subscribeUpload(token, listener),
    () => uploadProgress(token),
    () => 0,
  );

  useEffect(() => {
    let active = true;
    const fail = (message: string) => {
      toast.error(message);
      settlePlaceholder(editor, token, null);
    };
    if (!target) {
      fail(NO_TARGET_MESSAGE);
      return;
    }
    if (!storageReady) {
      fail(STORAGE_NOT_CONFIGURED_MESSAGE);
      return;
    }
    const pending = runUpload(token, (file, onProgress) => upload(file, target, { onProgress }));
    if (!pending) {
      // Left over from an interrupted upload (e.g. a reload): nothing to finish.
      settlePlaceholder(editor, token, null);
      return;
    }
    void pending.then((result) => {
      if (!active) return;
      if (!result.ok) {
        fail(result.error);
        return;
      }
      const view = result.data;
      const isImage = view.width !== null && view.height !== null && view.mime.startsWith("image/");
      settlePlaceholder(
        editor,
        token,
        isImage
          ? {
              type: IMAGE_NODE,
              attrs: {
                attachmentId: view.id,
                alt: altFromFilename(view.filename),
                width: view.width,
                height: view.height,
              },
            }
          : {
              type: "paragraph",
              content: [
                {
                  type: FILE_NODE,
                  attrs: { attachmentId: view.id, filename: view.filename, size: view.sizeBytes },
                },
              ],
            },
      );
    });
    return () => {
      active = false;
    };
  }, [editor, token, target, storageReady, upload]);

  const percent = Math.round(progress * 100);
  return (
    <NodeViewWrapper
      data-type={UPLOAD_NODE}
      contentEditable={false}
      className="my-2 flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
    >
      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      <span className="min-w-0 truncate">Uploading {filename}…</span>
      <progress
        max={100}
        value={percent}
        aria-label={`Uploading ${filename}`}
        className="ml-auto h-1.5 w-24 overflow-hidden rounded bg-muted"
      />
    </NodeViewWrapper>
  );
}

/** Transient: never parsed from HTML, so a copied placeholder cannot be pasted anywhere. */
export const AttachmentUpload = Node.create({
  name: UPLOAD_NODE,
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      token: { default: "" },
      filename: { default: "" },
      image: { default: false },
    };
  },

  parseHTML() {
    return [];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": UPLOAD_NODE })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(UploadPlaceholderView);
  },
});

function ImageNodeView({
  node,
  updateAttributes,
  deleteNode,
  selected,
  editor,
}: ReactNodeViewProps) {
  const attrs = imageNodeAttrs(node.attrs);
  const [editingAlt, setEditingAlt] = useState(false);
  const altId = useId();
  if (!attrs) return <NodeViewWrapper data-type={IMAGE_NODE} />;
  return (
    <NodeViewWrapper
      data-type={IMAGE_NODE}
      contentEditable={false}
      className={cn(
        "my-2 flex flex-col items-start gap-1",
        selected && "rounded-md ring-[3px] ring-ring/50",
      )}
    >
      {/* Authed route → short-lived signed URL; next/image cannot proxy it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={attachmentUrl(attrs.attachmentId)}
        alt={attrs.alt}
        width={attrs.width ?? undefined}
        height={attrs.height ?? undefined}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="h-auto max-w-full rounded-md border"
      />
      {editor.isEditable ? (
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {editingAlt ? (
            <>
              <label htmlFor={altId}>Alt text</label>
              <input
                id={altId}
                autoFocus
                defaultValue={attrs.alt}
                maxLength={MAX_ALT_LENGTH}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === "Escape") {
                    event.preventDefault();
                    if (event.key === "Enter") {
                      updateAttributes({ alt: event.currentTarget.value.trim() });
                    }
                    setEditingAlt(false);
                  }
                }}
                onBlur={(event) => {
                  updateAttributes({ alt: event.currentTarget.value.trim() });
                  setEditingAlt(false);
                }}
                className="h-6 min-w-48 rounded border border-input bg-background px-1.5 text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditingAlt(true)}
              className="rounded px-1 py-0.5 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {attrs.alt ? `Alt: ${attrs.alt}` : "Add alt text"}
            </button>
          )}
          <button
            type="button"
            aria-label="Remove image"
            onClick={() => deleteNode()}
            className="rounded p-1 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

export const AttachmentImage = Node.create({
  name: IMAGE_NODE,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      attachmentId: { default: null },
      alt: { default: "" },
      width: { default: null },
      height: { default: null },
    };
  },

  // Only our own nodes: an <img> pasted from elsewhere (any URL) is never turned into one.
  parseHTML() {
    return [];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": IMAGE_NODE })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});

export const FileAttachment = Node.create({
  name: FILE_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      attachmentId: { default: null },
      filename: { default: "file" },
      size: { default: null },
    };
  },

  parseHTML() {
    return [];
  },

  renderHTML({ node }) {
    const attrs = fileNodeAttrs(node.attrs);
    const label = attrs
      ? `${attrs.filename}${attrs.size !== null ? ` (${formatBytes(attrs.size)})` : ""}`
      : "Missing file";
    return [
      "span",
      {
        "data-type": FILE_NODE,
        class:
          "inline-flex items-center gap-1 rounded border bg-muted px-1.5 py-0.5 align-baseline text-xs",
      },
      `📎 ${label}`,
    ];
  },
});

function filesOf(list: FileList | null | undefined): File[] {
  return list ? Array.from(list) : [];
}

/** Paste and drop of files into the editor. */
export const AttachmentPaste = Extension.create({
  name: "attachmentPaste",

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("attachmentPaste"),
        props: {
          handlePaste: (_view, event) => {
            const data = event.clipboardData;
            const files = filesOf(data?.files);
            // Rich text copied from an office app also carries a picture of itself: text wins.
            if (files.length === 0 || (data?.getData("text/plain") ?? "") !== "") return false;
            event.preventDefault();
            return insertUploads(editor, files);
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved) return false;
            const files = filesOf(event.dataTransfer?.files);
            if (files.length === 0) return false;
            event.preventDefault();
            const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            return insertUploads(editor, files, position);
          },
        },
      }),
    ];
  },
});

/** Opens the system file picker (the keyboard alternative to drag and drop). */
export function pickFiles(editor: Editor): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.addEventListener("change", () => {
    insertUploads(editor, filesOf(input.files));
  });
  input.click();
}
