import { Extension } from "@tiptap/core";
import { type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { markdownToRichText } from "@/lib/markdown/to-rich-text";
import { extractPlainText, type RichTextNode } from "@/lib/rich-text";

/**
 * Pasting Markdown text (from a .md file, GitHub, a chat answer …) inserts it formatted, in
 * every editor. Only plain-text pastes are converted: a paste that already carries HTML
 * (web pages, Google Docs) keeps the editor's own handling, and so do files (attachments)
 * and pastes into a code block. ⌘/Ctrl+Shift+V always pastes the raw text.
 *
 * The converter is the handbook importer's (`markdownToRichText`); its output is fitted to
 * the editor's schema, so issue and comment editors (no tables, callouts or Mermaid) get the
 * closest thing they can hold instead of failing.
 */

/** Lines that only Markdown starts this way (headings, lists, quotes, fences, tables, rules). */
const BLOCK_PATTERNS = [
  /^#{1,6}\s+\S/m,
  /^\s{0,3}[-*+]\s+\S/m,
  /^\s{0,3}\d{1,9}[.)]\s+\S/m,
  /^\s{0,3}>\s?\S/m,
  /^\s{0,3}(```|~~~)/m,
  /^\s{0,3}\|.*\|\s*$/m,
  /^\s{0,3}([-*_])(\s*\1){2,}\s*$/m,
];

/** Inline Markdown: bold, inline code, links, strikethrough. */
const INLINE_PATTERNS = [
  /\*\*[^*\n]+\*\*/,
  /__[^_\n]+__/,
  /`[^`\n]+`/,
  /\[[^\]\n]+\]\((?:https?:\/\/|mailto:|\/|#)[^)\s]*\)/,
  /~~[^~\n]+~~/,
];

/** Whether pasted plain text reads as Markdown (rather than ordinary prose). */
export function looksLikeMarkdown(text: string): boolean {
  if (text.trim() === "") return false;
  return (
    BLOCK_PATTERNS.some((pattern) => pattern.test(text)) ||
    INLINE_PATTERNS.some((pattern) => pattern.test(text))
  );
}

/**
 * Fits converted nodes to `schema`: unknown marks are dropped; an unknown node keeps its
 * children (a callout becomes its paragraphs, a table its cells' paragraphs), and an unknown
 * leaf (Mermaid) becomes a code block, or its text.
 */
export function fitToSchema(nodes: readonly RichTextNode[], schema: Schema): RichTextNode[] {
  const out: RichTextNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const marks = node.marks?.filter((mark) => schema.marks[mark.type] !== undefined);
      out.push(marks && marks.length > 0 ? { ...node, marks } : { type: "text", text: node.text });
      continue;
    }
    if (schema.nodes[node.type]) {
      out.push(node.content ? { ...node, content: fitToSchema(node.content, schema) } : node);
      continue;
    }
    if (node.content) {
      out.push(...fitToSchema(node.content, schema));
      continue;
    }
    const text =
      typeof node.attrs?.source === "string" ? node.attrs.source : extractPlainText(node);
    if (!text) continue;
    if (schema.nodes.codeBlock) {
      out.push({ type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text }] });
    } else {
      out.push({ type: "paragraph", content: [{ type: "text", text }] });
    }
  }
  return out;
}

/** Inline nodes may not sit at block level: a run of them is wrapped in a paragraph. */
function wrapInline(nodes: RichTextNode[], schema: Schema): RichTextNode[] {
  const out: RichTextNode[] = [];
  let run: RichTextNode[] = [];
  const flush = () => {
    if (run.length > 0) out.push({ type: "paragraph", content: run });
    run = [];
  };
  for (const node of nodes) {
    if (node.type === "text" || schema.nodes[node.type]?.isInline) run.push(node);
    else {
      flush();
      out.push(node);
    }
  }
  flush();
  return out;
}

/**
 * What to insert for pasted Markdown: block nodes, or just the inline content when the paste
 * is a single paragraph (so it joins the line the cursor is on instead of splitting it).
 */
export function markdownPasteContent(text: string, schema: Schema): RichTextNode[] {
  const doc = markdownToRichText(text);
  const blocks = wrapInline(fitToSchema(doc.content ?? [], schema), schema);
  const [only] = blocks;
  if (blocks.length === 1 && only?.type === "paragraph") return only.content ?? [];
  return blocks;
}

const pluginKey = new PluginKey("markdownPaste");

export const MarkdownPaste = Extension.create({
  name: "markdownPaste",

  addProseMirrorPlugins() {
    const editor = this.editor;
    // Set by ⌘/Ctrl+Shift+V just before its paste event: that paste stays raw text.
    let plainNext = false;
    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleKeyDown: (_view, event) => {
            plainNext =
              event.shiftKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v";
            return false;
          },
          handlePaste: (view, event) => {
            const plain = plainNext;
            plainNext = false;
            const data = event.clipboardData;
            if (plain || !data) return false;
            // Files are attachments; HTML pastes keep the editor's handling. VS Code puts a
            // syntax-highlighted HTML copy next to the text: that one is still plain Markdown.
            if (data.files.length > 0) return false;
            const types = Array.from(data.types);
            if (types.includes("text/html") && !types.includes("vscode-editor-data")) return false;
            if (view.state.selection.$from.parent.type.spec.code) return false;
            const text = data.getData("text/plain");
            if (!looksLikeMarkdown(text)) return false;
            const content = markdownPasteContent(text, view.state.schema);
            if (content.length === 0) return false;
            event.preventDefault();
            const { $from, empty } = view.state.selection;
            const isBlocks = content.some((node) => node.type !== "text");
            // Pasting blocks into an empty paragraph replaces it, so no blank line is left.
            if (empty && isBlocks && $from.parent.isTextblock && $from.parent.content.size === 0) {
              return editor
                .chain()
                .focus()
                .insertContentAt({ from: $from.before(), to: $from.after() }, content)
                .run();
            }
            return editor.chain().focus().insertContent(content).run();
          },
        },
      }),
    ];
  },
});
