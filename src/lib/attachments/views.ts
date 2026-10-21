import { type AttachmentEntityType } from "./constants";
import { classifyUpload, type UploadCategory } from "./policy";

/**
 * An attachment as the UI sees it (ISS-9). Deliberately no storage key and no URL: the
 * browser builds `/api/files/<id>` itself (`attachmentUrl`), so neither a key nor a
 * presigned URL ever lands in server-rendered HTML (S-5).
 */
export interface AttachmentView {
  id: string;
  entityType: AttachmentEntityType;
  entityId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  uploadedBy: string | null;
  uploaderName: string | null;
  createdAt: Date;
}

/** What a presigned PUT needs on the browser side (`startUpload`'s result). */
export interface StartedUpload {
  attachmentId: string;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  /** The (possibly renamed) file name stored for display. */
  filename: string;
}

export function attachmentCategory(
  view: Pick<AttachmentView, "mime" | "filename">,
): UploadCategory {
  return classifyUpload(view.mime, view.filename).category;
}

const UNITS = ["B", "KB", "MB", "GB"] as const;

/** `1536` → "1.5 KB". */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[unit]}`;
}
