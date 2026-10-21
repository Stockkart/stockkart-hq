import { mergeRegistries } from "@/lib/registry";

import { attachmentRenderers } from "./attachments";
import { calloutRenderers, mermaidRenderers, tableRenderers } from "./doc-blocks";
import { mentionRenderers } from "./mentions";
import { type NodeRenderer, type NodeRenderers } from "./types";

/**
 * Read-only renderer registry for node types added by editor extensions (`RichTextView`).
 * To add a node, put its renderer in a file of its own in this folder and add ONE line
 * below (see AGENTS.md "Adding an editor node"). Unregistered types render only their
 * children, so a stored node the view does not know yet is never dropped silently.
 */
const RENDERERS: readonly NodeRenderers[] = [
  tableRenderers,
  calloutRenderers,
  mermaidRenderers,
  mentionRenderers,
  attachmentRenderers,
  // P1 slices add one line each, e.g. mentionRenderers, imageRenderers, diagramEmbedRenderers.
];

/** Throws at load if two files register the same node type (see `mergeRegistries`). */
export const NODE_RENDERERS: ReadonlyMap<string, NodeRenderer> = mergeRegistries(
  "Node renderers",
  RENDERERS,
);

export { type NodeRenderer, type NodeRenderers, type NodeRenderProps } from "./types";
