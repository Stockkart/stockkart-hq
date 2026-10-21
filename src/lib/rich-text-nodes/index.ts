import { mergeRegistries } from "@/lib/registry";

import { attachmentPlainText } from "./attachments";
import { diagramEmbedPlainText } from "./diagram-embed";
import { calloutPlainText, mermaidPlainText, tablePlainText } from "./doc-blocks";
import { mentionPlainText } from "./mentions";
import { type PlainTextRule, type PlainTextRules } from "./types";

/**
 * Plain-text registry for editor node types (used by `extractPlainText`). Isomorphic: the
 * server derives search text with it. To add a node, put its rules in a file of its own in
 * this folder and add ONE line below (see AGENTS.md "Adding an editor node").
 */
const RULES: readonly PlainTextRules[] = [
  calloutPlainText,
  tablePlainText,
  mermaidPlainText,
  mentionPlainText,
  attachmentPlainText,
  diagramEmbedPlainText,
  // A new node adds one line here.
];

/** Throws at load if two files register the same node type (see `mergeRegistries`). */
export const PLAIN_TEXT_RULES: ReadonlyMap<string, PlainTextRule> = mergeRegistries(
  "Plain-text rules",
  RULES,
);

export { type PlainTextRule, type PlainTextRules } from "./types";
