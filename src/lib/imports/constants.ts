/**
 * In-app import vocabulary (SPEC §4.17 IMP-4) shared by the schema enums, server code and
 * UI. Isomorphic. An `imports` row records one upload's preview and apply; the raw CSV is
 * never stored.
 */

/** `imports.kind`. */
export const IMPORT_KINDS = ["issues_csv"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/**
 * `imports.status`. `previewed` → `applied` (or `failed`) once: apply with
 * `UPDATE … WHERE status = 'previewed'` in the transaction that creates the issues, so a
 * double submit creates nothing. `applied_at` is set exactly when `applied` (CHECK).
 */
export const IMPORT_STATUSES = ["previewed", "applied", "failed"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** Longest stored filename (the original name, shown in the history). */
export const IMPORT_FILENAME_MAX = 255;

/** `imports.report` is bounded (CHECK on its text form) so a huge file cannot bloat a row. */
export const IMPORT_REPORT_MAX_BYTES = 1024 * 1024;

// ── IMP-4 CSV import of issues (slice B) ────────────────────────────────────────────────

/** Largest CSV file the import reads (checked in the browser before parsing). */
export const IMPORT_MAX_FILE_BYTES = 1024 * 1024;

/** Most data rows one import takes (enforced in the browser and by the server's schema). */
export const IMPORT_MAX_ROWS = 500;

/** Longest plain-text description per row (a CSV cell becomes one paragraph). */
export const IMPORT_DESCRIPTION_MAX = 5000;

/**
 * Cells are cut to this length before they are sent: one more than the longest field
 * allows, so a too-long value still gets its "too long" error, while the request stays
 * small. The server's schema refuses longer cells.
 */
export const IMPORT_CELL_MAX = IMPORT_DESCRIPTION_MAX + 1;

/**
 * Server actions accept bodies up to 1 MB (Next.js default), so the browser refuses a
 * mapped import larger than this before sending it (a CSV close to the 1 MB file limit
 * whose every byte is mapped can exceed it once encoded).
 */
export const IMPORT_MAX_PAYLOAD_BYTES = 1000 * 1000 - 32 * 1024;

/** A value quoted in an error message (stored in `imports.report`) is cut to this length. */
export const IMPORT_QUOTE_MAX = 40;

/** Errors kept in `imports.report` per import (the summary counts stay exact). */
export const IMPORT_REPORT_ERRORS_MAX = 2000;
