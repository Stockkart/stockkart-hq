import { calloutRenderers, mermaidRenderers, tableRenderers } from "./doc-blocks";
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
  // P1 slices add one line each, e.g. mentionRenderers, imageRenderers, diagramEmbedRenderers.
];

/** A Map, not an object, so a stored type such as "constructor" never hits a prototype key. */
export const NODE_RENDERERS: ReadonlyMap<string, NodeRenderer> = new Map(
  RENDERERS.flatMap((renderers) => Object.entries(renderers)),
);

export { type NodeRenderer, type NodeRenderers, type NodeRenderProps } from "./types";
