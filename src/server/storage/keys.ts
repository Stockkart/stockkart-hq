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

export const KEY_PREFIXES = {
  attachments: "attachments/",
  thumbnails: "thumbnails/",
  backups: "backups/",
  tmp: "tmp/",
} as const;

/** Prefixes the app may hand out presigned PUTs for. Backups are written only by the workflow. */
export const UPLOADABLE_PREFIXES: readonly string[] = [
  KEY_PREFIXES.attachments,
  KEY_PREFIXES.thumbnails,
];

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

/**
 * A well-formed key under one of our prefixes: no empty, `.` or `..` segments, no leading
 * slash, printable ASCII only. Every storage call checks this before signing anything.
 */
export function isValidKey(key: string): boolean {
  if (key.length === 0 || key.length > 512) return false;
  if (!/^[A-Za-z0-9._\-/]+$/.test(key)) return false;
  if (!Object.values(KEY_PREFIXES).some((prefix) => key.startsWith(prefix))) return false;
  const segments = key.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function isUploadableKey(key: string): boolean {
  return isValidKey(key) && UPLOADABLE_PREFIXES.some((prefix) => key.startsWith(prefix));
}
