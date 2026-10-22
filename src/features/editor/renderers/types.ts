import { type ReactNode } from "react";

import { type RichTextNode } from "@/lib/rich-text";

/**
 * Read-only rendering of one node type added by an editor extension (`RichTextView`). Works
 * in server and client components, so renderer files must not be "use client" and must
 * never produce HTML strings (S-8): return React elements, validate every attr you use.
 */
export interface NodeRenderProps {
  node: RichTextNode;
  /** React key for the returned element (the node's index among its siblings). */
  index: number;
  /** The node's children, already rendered. */
  children: ReactNode[];
  projectKeys: readonly string[];
}

export type NodeRenderer = (props: NodeRenderProps) => ReactNode;

/** One file's renderers, keyed by node type (`node.type`). */
export type NodeRenderers = Readonly<Record<string, NodeRenderer>>;
