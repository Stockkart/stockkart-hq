/**
 * Search snippets (SRCH-2) travel as plain text plus highlight ranges, never as HTML.
 *
 * The server asks Postgres' `ts_headline` to wrap matches in two control characters that
 * cannot come from user text (the server strips them from the source text first). This
 * module turns that marked-up string into `{ text, highlights }`; the UI renders `text` as
 * React text nodes and wraps the ranges in `<mark>`. Whatever the stored text contains
 * (`<script>`, `&lt;`, markdown), it is only ever displayed as text.
 */

/** Start and end of a highlight in `ts_headline` output (STX / ETX). */
export const HIGHLIGHT_START = "\u0002";
export const HIGHLIGHT_END = "\u0003";

export interface Snippet {
  text: string;
  /** `[start, end)` offsets into `text`, sorted and non-overlapping. */
  highlights: [number, number][];
}

export function parseHighlighted(marked: string): Snippet {
  let text = "";
  const highlights: [number, number][] = [];
  let open: number | null = null;
  for (const char of marked) {
    if (char === HIGHLIGHT_START) {
      if (open === null) open = text.length;
    } else if (char === HIGHLIGHT_END) {
      if (open !== null && text.length > open) highlights.push([open, text.length]);
      open = null;
    } else {
      text += char;
    }
  }
  // An unterminated highlight runs to the end.
  if (open !== null && text.length > open) highlights.push([open, text.length]);
  return { text, highlights };
}

/** `snippet` split into plain and highlighted runs, for rendering. */
export function snippetParts(snippet: Snippet): { text: string; highlight: boolean }[] {
  const parts: { text: string; highlight: boolean }[] = [];
  let last = 0;
  for (const [start, end] of snippet.highlights) {
    if (start < last || end > snippet.text.length || end <= start) continue;
    if (start > last) parts.push({ text: snippet.text.slice(last, start), highlight: false });
    parts.push({ text: snippet.text.slice(start, end), highlight: true });
    last = end;
  }
  if (last < snippet.text.length) parts.push({ text: snippet.text.slice(last), highlight: false });
  return parts;
}
