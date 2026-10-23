import { type ReactNode } from "react";

import { type RichTextMark, type RichTextNode } from "@/lib/rich-text";

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

/**
 * Read-only rendering of a mark added by an editor extension (e.g. DOC-13 `commentAnchor`):
 * wraps the already-rendered text. Same rules as node renderers (React elements only,
 * validate every attr). Core marks (bold, links, …) are built into `RichTextView`.
 */
export interface MarkRenderProps {
  mark: RichTextMark;
  /** React key for the returned element. */
  index: number;
  children: ReactNode;
}

export type MarkRenderer = (props: MarkRenderProps) => ReactNode;

/** One file's mark renderers, keyed by mark type (`mark.type`). */
export type MarkRenderers = Readonly<Record<string, MarkRenderer>>;
