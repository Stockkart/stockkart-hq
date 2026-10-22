import { type RichTextNode } from "@/lib/rich-text";

/**
 * How `extractPlainText` treats a node type that an editor extension adds (search text,
 * `STK-123` extraction). Core ProseMirror nodes (paragraph, lists, code blocks …) are built
 * into `extractPlainText`; everything else registers a rule in `rich-text-nodes/index.ts`.
 */
export interface PlainTextRule {
  /** Starts and ends its own line(s). */
  block?: boolean;
  /** Counts as code: left out with `skipCode`, so references in it are not mentions. */
  code?: boolean;
  /** Text the node contributes itself (from attrs), before its children. */
  text?: (node: RichTextNode) => string;
}

/** One file's rules, keyed by node type (`node.type`). */
export type PlainTextRules = Readonly<Record<string, PlainTextRule>>;
