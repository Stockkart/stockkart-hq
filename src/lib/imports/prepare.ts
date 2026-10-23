import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_PAYLOAD_BYTES, IMPORT_MAX_ROWS } from "./constants";
import { parseCsv } from "./csv";

/**
 * IMP-4 browser-side checks of an uploaded CSV, before anything is sent: size, CSV syntax,
 * a header row and 1…`IMPORT_MAX_ROWS` data rows. Pure, so the limits are unit-tested.
 */

export type PreparedImport =
  { ok: true; headers: string[]; rows: string[][] } | { ok: false; error: string };

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`;

/** The file's size limit, checked before reading it. */
export function fileSizeProblem(sizeBytes: number): string | null {
  return sizeBytes > IMPORT_MAX_FILE_BYTES
    ? `The file is ${mb(sizeBytes)}; the limit is ${mb(IMPORT_MAX_FILE_BYTES)}`
    : null;
}

export function prepareImport(text: string, sizeBytes: number): PreparedImport {
  const tooBig = fileSizeProblem(sizeBytes);
  if (tooBig) return { ok: false, error: tooBig };
  const parsed = parseCsv(text);
  if (parsed.error) return { ok: false, error: `Not a valid CSV file. ${parsed.error}` };
  const [headers, ...rows] = parsed.rows;
  if (!headers) return { ok: false, error: "The file is empty" };
  if (rows.length === 0) return { ok: false, error: "The file has a header row but no issues" };
  if (rows.length > IMPORT_MAX_ROWS) {
    return {
      ok: false,
      error: `The file has ${rows.length} rows; import at most ${IMPORT_MAX_ROWS} at a time (split the file)`,
    };
  }
  return { ok: true, headers: headers.map((header) => header.trim()), rows };
}

/** Whether a request body (the action's JSON input) would exceed the server's limit. */
export function payloadTooLarge(input: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(input)).length > IMPORT_MAX_PAYLOAD_BYTES;
}
