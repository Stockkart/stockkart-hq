import MarkdownIt from "markdown-it";

import { isSafeHref } from "@/features/editor/safe-href";
import {
  extractPlainText,
  type RichTextDoc,
  type RichTextMark,
  type RichTextNode,
} from "@/lib/rich-text";

/**
 * Markdown → editor JSON (IMP-2), for the handbook import. Covers what the handbook uses:
 * headings, paragraphs, bullet/numbered/task lists, tables, code fences (```mermaid fences
 * become Mermaid blocks, DOC-7), blockquotes, rules, links and inline code/bold/italic/strike.
 *
 * Parsed with markdown-it (MIT) with raw HTML off: `<b>` or `<script>` in the markdown stays
 * literal text, so nothing imported can become markup (S-8). Links keep only http(s)/mailto
 * and relative targets (`isSafeHref`); images become their alt text (no blob store yet).
 */

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

type Token = ReturnType<typeof md.parse>[number];

const OPEN_TYPES: Record<string, (token: Token) => RichTextNode> = {
  heading_open: (token) => ({
    type: "heading",
    attrs: { level: Math.min(3, Math.max(1, Number(token.tag.slice(1)) || 3)) },
  }),
  paragraph_open: () => ({ type: "paragraph" }),
  bullet_list_open: () => ({ type: "bulletList" }),
  ordered_list_open: (token) => {
    const start = Number(token.attrGet("start") ?? "1");
    return Number.isInteger(start) && start !== 1
      ? { type: "orderedList", attrs: { start } }
      : { type: "orderedList" };
  },
  list_item_open: () => ({ type: "listItem" }),
  blockquote_open: () => ({ type: "blockquote" }),
  table_open: () => ({ type: "table" }),
  tr_open: () => ({ type: "tableRow" }),
  th_open: () => ({ type: "tableHeader" }),
  td_open: () => ({ type: "tableCell" }),
};

/** Grouping tokens with no node of their own. */
const IGNORED = new Set(["thead_open", "thead_close", "tbody_open", "tbody_close"]);

const TASK_PREFIX = /^\[([ xX])\]\s+/;

const sameMarks = (a: RichTextMark[] | undefined, b: RichTextMark[] | undefined) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

function inlineNodes(token: Token): RichTextNode[] {
  const out: RichTextNode[] = [];
  const marks: RichTextMark[] = [];
  /** One entry per open link: the mark pushed, or null for a dropped (unsafe) link. */
  const links: (RichTextMark | null)[] = [];

  const addText = (text: string, nodeMarks: RichTextMark[] = marks) => {
    // ProseMirror text nodes must not be empty.
    if (text === "") return;
    const copy = nodeMarks.length > 0 ? nodeMarks.map((mark) => ({ ...mark })) : undefined;
    const last = out.at(-1);
    if (last?.type === "text" && sameMarks(last.marks, copy)) {
      last.text = `${last.text ?? ""}${text}`;
      return;
    }
    out.push(copy ? { type: "text", text, marks: copy } : { type: "text", text });
  };
  const removeMark = (type: string) => {
    const index = marks.map((mark) => mark.type).lastIndexOf(type);
    if (index >= 0) marks.splice(index, 1);
  };

  for (const child of token.children ?? []) {
    switch (child.type) {
      case "text":
      case "html_inline":
        addText(child.content);
        break;
      case "code_inline":
        // Tiptap's code mark excludes other marks; keep a surrounding link only.
        addText(child.content, [{ type: "code" }, ...marks.filter((mark) => mark.type === "link")]);
        break;
      case "softbreak":
        addText(" ");
        break;
      case "hardbreak":
        out.push({ type: "hardBreak" });
        break;
      case "strong_open":
        marks.push({ type: "bold" });
        break;
      case "strong_close":
        removeMark("bold");
        break;
      case "em_open":
        marks.push({ type: "italic" });
        break;
      case "em_close":
        removeMark("italic");
        break;
      case "s_open":
        marks.push({ type: "strike" });
        break;
      case "s_close":
        removeMark("strike");
        break;
      case "link_open": {
        const href = child.attrGet("href");
        const mark = isSafeHref(href) ? { type: "link", attrs: { href } } : null;
        links.push(mark);
        if (mark) marks.push(mark);
        break;
      }
      case "link_close": {
        const mark = links.pop();
        if (mark) marks.splice(marks.lastIndexOf(mark), 1);
        break;
      }
      case "image":
        addText(child.content);
        break;
      default:
        addText(child.content);
    }
  }
  return out;
}

/** Turns a bullet list whose items all start with `[ ]` / `[x]` into a task list. */
function asTaskList(list: RichTextNode): RichTextNode {
  const items = list.content ?? [];
  const firstText = (item: RichTextNode) => item.content?.[0]?.content?.[0];
  const isTask = (item: RichTextNode) => {
    const first = item.content?.[0];
    const text = firstText(item);
    return (
      first?.type === "paragraph" && text?.type === "text" && TASK_PREFIX.test(text.text ?? "")
    );
  };
  if (items.length === 0 || !items.every(isTask)) return list;
  return {
    type: "taskList",
    content: items.map((item) => {
      const [paragraph, ...rest] = item.content ?? [];
      const [text, ...inline] = paragraph?.content ?? [];
      const match = TASK_PREFIX.exec(text?.text ?? "");
      const remaining = (text?.text ?? "").slice(match?.[0].length ?? 0);
      const head = text && remaining ? [{ ...text, text: remaining }] : [];
      const paragraphContent = [...head, ...inline];
      return {
        type: "taskItem",
        attrs: { checked: match?.[1]?.toLowerCase() === "x" },
        content: [
          paragraphContent.length > 0
            ? { type: "paragraph", content: paragraphContent }
            : { type: "paragraph" },
          ...rest,
        ],
      };
    }),
  };
}

/** Fixes a node up to the editor schema once all its children are known. */
function finish(node: RichTextNode): RichTextNode {
  const content = node.content ?? [];
  switch (node.type) {
    case "listItem":
      // Tiptap list items start with a paragraph.
      return content[0]?.type === "paragraph"
        ? node
        : { ...node, content: [{ type: "paragraph" }, ...content] };
    case "tableHeader":
    case "tableCell":
    case "blockquote":
      return content.length > 0 ? node : { ...node, content: [{ type: "paragraph" }] };
    case "bulletList":
      return asTaskList(node);
    default:
      return node;
  }
}

export function markdownToRichText(markdown: string): RichTextDoc {
  const root: RichTextNode = { type: "doc", content: [] };
  const stack: RichTextNode[] = [root];
  const top = (): RichTextNode => stack[stack.length - 1] ?? root;
  const append = (node: RichTextNode) => {
    const parent = top();
    parent.content = [...(parent.content ?? []), node];
  };

  for (const token of md.parse(markdown, {})) {
    if (IGNORED.has(token.type)) continue;
    const open = OPEN_TYPES[token.type];
    if (open) {
      const node = open(token);
      append(node);
      stack.push(node);
      continue;
    }
    if (token.type.endsWith("_close")) {
      const node = stack.pop();
      const parent = top();
      if (node && parent.content) {
        // Replace the node in its parent with its finished form.
        const index = parent.content.lastIndexOf(node);
        if (index >= 0) parent.content[index] = finish(node);
      }
      continue;
    }
    switch (token.type) {
      case "inline": {
        const inline = inlineNodes(token);
        const parent = top();
        if (parent.type === "tableHeader" || parent.type === "tableCell") {
          // Table cells hold blocks; markdown gives them bare inline content.
          append(
            inline.length > 0 ? { type: "paragraph", content: inline } : { type: "paragraph" },
          );
        } else if (inline.length > 0) {
          parent.content = [...(parent.content ?? []), ...inline];
        }
        break;
      }
      case "fence":
      case "code_block": {
        const language = token.info.trim().split(/\s+/)[0] ?? "";
        const code = token.content.replace(/\n$/, "");
        if (language.toLowerCase() === "mermaid") {
          append({ type: "mermaid", attrs: { source: code } });
        } else {
          append({
            type: "codeBlock",
            attrs: { language: language || null },
            ...(code ? { content: [{ type: "text", text: code }] } : {}),
          });
        }
        break;
      }
      case "hr":
        append({ type: "horizontalRule" });
        break;
      default:
        // html_block (only with html on) and anything new: keep the text, never markup.
        if (token.content)
          append({ type: "paragraph", content: [{ type: "text", text: token.content }] });
    }
  }
  return { type: "doc", content: root.content?.length ? root.content : [{ type: "paragraph" }] };
}

/** A leading `# Title` becomes the doc title (the page shows the title itself). */
export function takeTitle(doc: RichTextDoc): { title: string | null; doc: RichTextDoc } {
  const [first, ...rest] = doc.content ?? [];
  if (first?.type !== "heading" || first.attrs?.level !== 1) return { title: null, doc };
  const title = extractPlainText(first).trim();
  return {
    title: title || null,
    doc: { ...doc, content: rest.length > 0 ? rest : [{ type: "paragraph" }] },
  };
}

/** Plain text of the blocks under the heading named `name`, up to the next heading. */
export function sectionText(doc: RichTextDoc, name: string): string | null {
  const blocks = doc.content ?? [];
  const start = blocks.findIndex(
    (node) =>
      node.type === "heading" && extractPlainText(node).trim().toLowerCase() === name.toLowerCase(),
  );
  if (start < 0) return null;
  const body: RichTextNode[] = [];
  for (const node of blocks.slice(start + 1)) {
    if (node.type === "heading") break;
    body.push(node);
  }
  return extractPlainText({ type: "doc", content: body });
}
