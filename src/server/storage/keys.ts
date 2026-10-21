import { randomUUID } from "node:crypto";

/**
 * Object key layout of the private R2 bucket (S-5). Keys are built only here, from server-side
 * ids and a sanitized file name, so no caller can address another prefix by accident:
 *
 *   attachments/<uuid>/<sanitized-filename>   ISS-9 / DOC-1 uploads (presigned PUT)
 *   thumbnails/diagrams/<diagramId>.png       DGM-5 thumbnails
 *   backups/<name>.sql.gz                     nightly pg_dump (.github/workflows/backup.yml)
 *   tmp/<name>                                in-flight backups; 1-day lifecycle rule
 */

/**
 * `backups/` and `tmp/` belong to the backup workflow only: the app can neither sign nor
 * send anything for them (`isAppKey`).
 */
export const KEY_PREFIXES = {
  attachments: "attachments/",
  thumbnails: "thumbnails/",
  backups: "backups/",
  tmp: "tmp/",
} as const;

const MAX_FILENAME_LENGTH = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * A file name safe to use inside an object key: the last path segment only, accents
 * stripped, anything but `A-Z a-z 0-9 . _ -` replaced by `_`, no leading dots, at most 100
 * characters (keeping the extension). The original name is kept separately for display.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "";
  let safe = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .replace(/_+/g, "_");
  if (safe.length > MAX_FILENAME_LENGTH) {
    const dot = safe.lastIndexOf(".");
    const extension = dot > 0 && safe.length - dot <= 10 ? safe.slice(dot) : "";
    safe = safe.slice(0, MAX_FILENAME_LENGTH - extension.length) + extension;
  }
  return safe === "" || /^[._-]+$/.test(safe) ? "file" : safe;
}

/** `attachments/<uuid>/<sanitized-filename>`; the uuid makes every key unique. */
export function attachmentKey(filename: string, id: string = randomUUID()): string {
  if (!isUuid(id)) throw new Error("attachmentKey needs a uuid");
  return `${KEY_PREFIXES.attachments}${id.toLowerCase()}/${sanitizeFilename(filename)}`;
}

/** `thumbnails/diagrams/<diagramId>.png` (DGM-5); overwritten on every save. */
export function diagramThumbnailKey(diagramId: string): string {
  if (!isUuid(diagramId)) throw new Error("diagramThumbnailKey needs a uuid");
  return `${KEY_PREFIXES.thumbnails}diagrams/${diagramId.toLowerCase()}.png`;
}

/** `attachments/<uuid>/<sanitized-filename>` exactly (see `sanitizeFilename`). */
const ATTACHMENT_KEY_PATTERN =
  /^attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9-][A-Za-z0-9._-]{0,99}$/;
/** `thumbnails/diagrams/<uuid>.png` exactly. */
const THUMBNAIL_KEY_PATTERN =
  /^thumbnails\/diagrams\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/;

/**
 * Whether the app may touch this key at all: exactly one of the layouts the app writes
 * (attachments, diagram thumbnails). Every storage call (upload, download, head, put,
 * delete) checks this before signing or sending anything, so a bad or tampered
 * `storage_key`/`thumbnail_key` can never reach `backups/`, `tmp/` or anything else. The
 * same layouts are CHECK constraints on `attachments.storage_key` and
 * `diagrams.thumbnail_key`.
 */
export function isAppKey(key: string): boolean {
  return ATTACHMENT_KEY_PATTERN.test(key) || THUMBNAIL_KEY_PATTERN.test(key);
}
