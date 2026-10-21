import { type RichTextNode } from "@/lib/rich-text";

/**
 * Editor nodes that point at attachments (ISS-9, DOC-1). Isomorphic: the editor, the
 * read-only renderer and the plain-text extractor share these attr parsers, so a stored node
 * with a bad attr is handled the same everywhere (it renders nothing rather than a broken
 * `src`).
 *
 *   image           { attachmentId, alt, width, height }   block, served by /api/files/<id>
 *   fileAttachment  { attachmentId, filename, size }        inline chip, downloads
 *
 * The node never holds a storage key or a presigned URL: the browser always goes through
 * the authed `/api/files/[id]` route (S-5).
 */

export const IMAGE_NODE = "image";
export const FILE_NODE = "fileAttachment";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Larger than any sane screenshot, small enough to keep layout maths sane. */
const MAX_DIMENSION = 20_000;
export const MAX_ALT_LENGTH = 500;

export interface ImageNodeAttrs {
  attachmentId: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface FileNodeAttrs {
  attachmentId: string;
  filename: string;
  size: number | null;
}

function dimension(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_DIMENSION
    ? value
    : null;
}

function attachmentIdOf(attrs: Record<string, unknown> | undefined): string | null {
  const id = attrs?.attachmentId;
  return typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null;
}

/** Validated attrs of an `image` node, or null when it has no usable attachment id. */
export function imageNodeAttrs(attrs: Record<string, unknown> | undefined): ImageNodeAttrs | null {
  const attachmentId = attachmentIdOf(attrs);
  if (!attachmentId) return null;
  const alt = typeof attrs?.alt === "string" ? attrs.alt.slice(0, MAX_ALT_LENGTH) : "";
  const width = dimension(attrs?.width);
  const height = dimension(attrs?.height);
  // Both or neither: one dimension alone cannot reserve the box (no layout shift).
  return width && height
    ? { attachmentId, alt, width, height }
    : { attachmentId, alt, width: null, height: null };
}

/** Validated attrs of a `fileAttachment` node, or null when it has no usable attachment id. */
export function fileNodeAttrs(attrs: Record<string, unknown> | undefined): FileNodeAttrs | null {
  const attachmentId = attachmentIdOf(attrs);
  if (!attachmentId) return null;
  const filename =
    typeof attrs?.filename === "string" && attrs.filename.trim() !== ""
      ? attrs.filename.slice(0, 255)
      : "file";
  const size =
    typeof attrs?.size === "number" && Number.isSafeInteger(attrs.size) && attrs.size >= 0
      ? attrs.size
      : null;
  return { attachmentId, filename, size };
}

/** The authed route every attachment is fetched through (never a bucket URL). */
export function attachmentUrl(attachmentId: string, options: { download?: boolean } = {}): string {
  return `/api/files/${encodeURIComponent(attachmentId)}${options.download ? "?download=1" : ""}`;
}

/** Attachment ids referenced by image and file nodes anywhere in a document, deduplicated. */
export function attachmentIdsIn(doc: RichTextNode | null | undefined): string[] {
  const ids = new Set<string>();
  const visit = (node: RichTextNode) => {
    if (node.type === IMAGE_NODE || node.type === FILE_NODE) {
      const id = attachmentIdOf(node.attrs);
      if (id) ids.add(id);
    }
    node.content?.forEach(visit);
  };
  if (doc) visit(doc);
  return [...ids];
}
