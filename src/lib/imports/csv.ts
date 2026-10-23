/**
 * A small RFC 4180 CSV reader and the export-side cell escaper (IMP-4). Isomorphic: the
 * import dialog parses the file in the browser, so the raw file never leaves it (only the
 * mapped cells are sent, and nothing is stored).
 *
 * Our own ~80 lines instead of a dependency (e.g. papaparse): the format is small, we need
 * only the RFC 4180 subset spreadsheets write, and every rule is pinned by tests
 * (`csv.test.ts`). Accepted on top of RFC 4180: a UTF-8 BOM, LF or CRLF (or lone CR) line
 * ends, a missing final newline, blank lines (skipped) and a stray quote inside an
 * unquoted field (kept as text).
 */

export interface CsvParseResult {
  /** Records in file order; blank lines are skipped. Cells are not trimmed. */
  rows: string[][];
  /** The first problem found, if the file is not well-formed CSV. */
  error: string | null;
}

/** Parses `text`; on a malformed quote it stops and reports where. */
export function parseCsv(text: string): CsvParseResult {
  const input = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  /** The current cell was quoted and its closing quote has been read. */
  let closed = false;
  let line = 1;

  const endCell = () => {
    row.push(cell);
    cell = "";
    closed = false;
  };
  const endRow = () => {
    endCell();
    // A blank line is one empty, unquoted cell: skip it.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        if (char === "\n") line += 1;
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      if (closed) return { rows, error: `Line ${line}: text after a closing quote` };
      // A quote inside an unquoted field is kept as text (lenient, as spreadsheets are).
      if (cell !== "") cell += char;
      else quoted = true;
    } else if (char === ",") {
      endCell();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      endRow();
      line += 1;
    } else {
      if (closed) return { rows, error: `Line ${line}: text after a closing quote` };
      cell += char;
    }
  }
  if (quoted) return { rows, error: `Line ${line}: a quoted field is not closed` };
  if (cell !== "" || closed || row.length > 0) endRow();
  return { rows, error: null };
}

/** Characters that make a spreadsheet read a cell as a formula (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One cell for a CSV export: a text value starting with `=`, `+`, `-` or `@` (or a tab or
 * CR) is prefixed with `'` so spreadsheets show it as text instead of running it as a
 * formula (OWASP "CSV injection"); then it is quoted when it holds a comma, quote or line
 * break. Numbers are written as they are (`-5` cannot be a formula).
 */
export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  let text = value;
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
