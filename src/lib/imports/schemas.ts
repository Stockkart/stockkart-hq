import { z } from "zod";

import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";

import { IMPORT_CELL_MAX, IMPORT_FILENAME_MAX, IMPORT_MAX_ROWS } from "./constants";
import { IMPORT_FIELDS } from "./fields";

/**
 * IMP-4 action inputs. The browser parses the CSV and sends only the mapped cells (never
 * the file); `fields` names the column of each cell. The server re-validates every row.
 */

const fields = z
  .array(z.enum(IMPORT_FIELDS))
  .min(1)
  .max(IMPORT_FIELDS.length)
  .refine((list) => new Set(list).size === list.length, "Map each field once")
  .refine((list) => list.includes("title"), "Map a column to Title");

const rows = z
  .array(z.array(z.string().max(IMPORT_CELL_MAX, "A cell is too long")))
  .min(1, "The file has no rows to import")
  .max(IMPORT_MAX_ROWS, `Import at most ${IMPORT_MAX_ROWS} rows at a time`);

/** Code points that could disguise a file name in the history (see `printable`). */
const HIDDEN_RANGES: readonly [number, number][] = [
  [0x00, 0x1f], // C0 controls
  [0x7f, 0x9f], // DEL and C1 controls
  [0xad, 0xad], // soft hyphen
  [0x061c, 0x061c], // Arabic letter mark
  [0x200b, 0x200f], // zero-width characters and direction marks
  [0x2028, 0x2029], // line and paragraph separators
  [0x202a, 0x202e], // bidi embeddings and overrides (a name that reads backwards)
  [0x2060, 0x2064], // word joiner and invisible operators
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
];

/** Drops control, zero-width and bidi-control characters from a file name. */
const printable = (value: string) =>
  [...value]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return !HIDDEN_RANGES.some(([from, to]) => code >= from && code <= to);
    })
    .join("");

/** The original file name, kept for the history (path parts dropped, control chars out). */
const filename = z
  .string()
  .transform((value) =>
    printable(value.split(/[\\/]/).at(-1) ?? "")
      .trim()
      .slice(0, IMPORT_FILENAME_MAX),
  )
  .pipe(z.string().min(1, "The file needs a name"));

const cellsMatchFields = (value: { fields: string[]; rows: string[][] }) =>
  value.rows.every((row) => row.length === value.fields.length);

export const previewImportInput = z
  .object({ projectKey: z.string().regex(PROJECT_KEY_PATTERN), filename, fields, rows })
  .refine(cellsMatchFields, "Every row needs one cell per mapped field");
export type PreviewImportInput = z.input<typeof previewImportInput>;

/** Apply sends the same cells again; they must match the preview's (hash in the report). */
export const applyImportInput = z
  .object({ importId: z.uuid(), fields, rows })
  .refine(cellsMatchFields, "Every row needs one cell per mapped field");
export type ApplyImportInput = z.input<typeof applyImportInput>;
