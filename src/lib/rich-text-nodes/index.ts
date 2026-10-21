import { calloutPlainText, mermaidPlainText, tablePlainText } from "./doc-blocks";
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
  // P1 slices add one line each, e.g. mentionPlainText, imagePlainText, diagramEmbedPlainText.
];

/** A Map, not an object, so a stored type such as "constructor" never hits a prototype key. */
export const PLAIN_TEXT_RULES: ReadonlyMap<string, PlainTextRule> = new Map(
  RULES.flatMap((rules) => Object.entries(rules)),
);

export { type PlainTextRule, type PlainTextRules } from "./types";
