import { IMPORT_CELL_MAX } from "./constants";

/**
 * IMP-4 import columns and the header → field mapping. Isomorphic: the import dialog maps
 * the CSV's columns in the browser and sends the cells per field; the server validates them
 * (`validate.ts`).
 */

/** The issue fields a CSV column can fill, in the order the mapping step lists them. */
export const IMPORT_FIELDS = [
  "title",
  "type",
  "priority",
  "status",
  "assignee",
  "labels",
  "points",
  "due_date",
  "description",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  title: "Title",
  type: "Type",
  priority: "Priority",
  status: "Status",
  assignee: "Assignee",
  labels: "Labels",
  points: "Points",
  due_date: "Due date",
  description: "Description",
};

/** What each field accepts (shown in the mapping step). */
export const IMPORT_FIELD_HINTS: Record<ImportField, string> = {
  title: "Required, up to 255 characters",
  type: "Epic, story, task, bug, spike or tech-debt (default: task)",
  priority: "P0–P3 or 0–3 (default: P2)",
  status: "A status name of the project (default: the type's start status)",
  assignee: "An HQ user's email or name (default: the project's default assignee)",
  labels: "Separated by semicolons, e.g. backend;ocr",
  points: "A whole number, 0–999",
  due_date: "YYYY-MM-DD",
  description: "Plain text, becomes one paragraph",
};

/** A column mapping: the CSV column index for each mapped field. Title is required. */
export type ColumnMapping = Partial<Record<ImportField, number>>;

/** `Due Date`, `due-date` and `DUE_DATE` all read as `due_date`. */
export function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/** Other headers people use for a field (after `normaliseHeader`). */
const ALIASES: Partial<Record<ImportField, readonly string[]>> = {
  points: ["story_points", "storypoints", "estimate"],
  due_date: ["due", "duedate"],
  labels: ["label", "tags"],
  assignee: ["assigned_to"],
  title: ["summary"],
};

/**
 * The mapping a header row suggests: each field takes the first column whose header
 * matches its name (case-insensitively) or an alias. A column fills at most one field.
 */
export function suggestMapping(headers: readonly string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    const names = [field, ...(ALIASES[field] ?? [])];
    const index = headers.findIndex(
      (header, i) => !used.has(i) && names.includes(normaliseHeader(header)),
    );
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }
  return mapping;
}

/** The mapped fields in `IMPORT_FIELDS` order. */
export function mappedFields(mapping: ColumnMapping): ImportField[] {
  return IMPORT_FIELDS.filter((field) => mapping[field] !== undefined);
}

/**
 * The cells to send for `dataRows` (the CSV rows after the header): one array per row, in
 * `mappedFields(mapping)` order; a missing cell is empty and every cell is cut to
 * `IMPORT_CELL_MAX` (see there).
 */
export function payloadRows(dataRows: readonly string[][], mapping: ColumnMapping): string[][] {
  const fields = mappedFields(mapping);
  return dataRows.map((row) =>
    fields.map((field) => {
      const index = mapping[field];
      return (index === undefined ? "" : (row[index] ?? "")).slice(0, IMPORT_CELL_MAX);
    }),
  );
}
