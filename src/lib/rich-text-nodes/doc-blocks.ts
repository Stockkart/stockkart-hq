import { type RichTextNode } from "@/lib/rich-text";

import { type PlainTextRules } from "./types";

/** DOC-1 callouts and tables: each callout, table and table cell is its own line. */
export const calloutPlainText: PlainTextRules = {
  callout: { block: true },
};

export const tablePlainText: PlainTextRules = {
  table: { block: true },
  tableRow: { block: true },
  tableCell: { block: true },
  tableHeader: { block: true },
};

/** The source of a Mermaid block (DOC-7), stored as `attrs.source`, not as child text. */
function mermaidSource(node: RichTextNode): string {
  const source = node.attrs?.source;
  return typeof source === "string" ? source : "";
}

/** Mermaid source is searchable, but counts as code: `STK-1` inside a diagram is not a mention. */
export const mermaidPlainText: PlainTextRules = {
  mermaid: { block: true, code: true, text: mermaidSource },
};
