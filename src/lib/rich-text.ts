import { z } from "zod";

/**
 * Rich text as stored in Postgres (`issues.description`, `comments.body`, `docs.content`):
 * the editor's ProseMirror/Tiptap JSON document (SPEC §7.3). Plain text for search is always
 * derived on the server from this JSON with `extractPlainText`, never taken from the client.
 *
 * Isomorphic: shared by the editor (client), server actions and the read-only renderer.
 */

export interface RichTextMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
}

export interface RichTextDoc extends RichTextNode {
  type: "doc";
}

/** Limits keep a single document bounded before Zod walks it recursively. */
export const RICH_TEXT_LIMITS = {
  maxDepth: 40,
  maxNodes: 20_000,
  maxJsonChars: 500_000,
} as const;

/** Iterative (no recursion) so a maliciously deep payload cannot overflow the stack. */
function withinLimits(value: unknown): boolean {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return false;
  }
  if (json === undefined || json.length > RICH_TEXT_LIMITS.maxJsonChars) return false;
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 1 }];
  let count = 0;
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) break;
    count += 1;
    if (count > RICH_TEXT_LIMITS.maxNodes || next.depth > RICH_TEXT_LIMITS.maxDepth) return false;
    const { node } = next;
    if (typeof node === "object" && node !== null && "content" in node) {
      const content: unknown = node.content;
      if (Array.isArray(content)) {
        for (const child of content) stack.push({ node: child, depth: next.depth + 1 });
      }
    }
  }
  return true;
}

const markSchema: z.ZodType<RichTextMark> = z.object({
  type: z.string().min(1).max(64),
  attrs: z.record(z.string(), z.unknown()).optional(),
});

const nodeSchema: z.ZodType<RichTextNode> = z.lazy(() =>
  z.object({
    type: z.string().min(1).max(64),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(nodeSchema).optional(),
    marks: z.array(markSchema).max(20).optional(),
    text: z.string().optional(),
  }),
);

export const richTextDocSchema: z.ZodType<RichTextDoc> = z
  .unknown()
  .refine(withinLimits, { message: "Document is too large or too deeply nested" })
  .pipe(
    z.lazy(() =>
      z.object({
        type: z.literal("doc"),
        attrs: z.record(z.string(), z.unknown()).optional(),
        content: z.array(nodeSchema).optional(),
      }),
    ),
  );

export function emptyDoc(): RichTextDoc {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

/** Nodes rendered as their own line(s) in plain text. */
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "listItem",
  "taskItem",
  "bulletList",
  "orderedList",
  "taskList",
  "horizontalRule",
]);

/** Plain text for search and `STK-123` extraction: one line per block. */
export function extractPlainText(doc: RichTextNode): string {
  const lines: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim() !== "") lines.push(current.trim());
    current = "";
  };
  const visit = (node: RichTextNode) => {
    if (node.type === "text") {
      current += node.text ?? "";
      return;
    }
    if (node.type === "hardBreak") {
      current += "\n";
      return;
    }
    const isBlock = BLOCK_TYPES.has(node.type);
    if (isBlock) flush();
    for (const child of node.content ?? []) visit(child);
    if (isBlock) flush();
  };
  visit(doc);
  flush();
  return lines.join("\n");
}

export function isEmptyDoc(doc: RichTextNode | null | undefined): boolean {
  return !doc || extractPlainText(doc) === "";
}

/** Builders for seeded templates (SPEC §6). */
export const rt = {
  doc: (...content: RichTextNode[]): RichTextDoc => ({ type: "doc", content }),
  heading: (level: 1 | 2 | 3, text: string): RichTextNode => ({
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  }),
  paragraph: (text?: string): RichTextNode =>
    text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" },
  bullets: (...items: string[]): RichTextNode => ({
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [rt.paragraph(item)],
    })),
  }),
  checklist: (...items: string[]): RichTextNode => ({
    type: "taskList",
    content: items.map((item) => ({
      type: "taskItem",
      attrs: { checked: false },
      content: [rt.paragraph(item)],
    })),
  }),
};
