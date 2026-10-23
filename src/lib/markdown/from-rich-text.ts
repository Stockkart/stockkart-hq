import MarkdownIt from "markdown-it";

import { isSafeHref } from "@/features/editor/safe-href";
import {
  attachmentUrl,
  FILE_NODE,
  fileNodeAttrs,
  IMAGE_NODE,
  imageNodeAttrs,
  UPLOAD_NODE,
} from "@/lib/attachments/nodes";
import { canonicalJson } from "@/lib/canonical-json";
import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import { USER_MENTION_NODE } from "@/lib/mentions";
import {
  extractPlainText,
  type RichTextDoc,
  type RichTextMark,
  type RichTextNode,
} from "@/lib/rich-text";
import { DIAGRAM_EMBED_NODE, diagramEmbedAttrs } from "@/lib/rich-text-nodes/diagram-embed";
import { mentionLabel } from "@/lib/rich-text-nodes/mentions";

import {
  asCallout,
  asTaskList,
  CALLOUT_LABELS,
  HQ_ONLY_LINKS_NOTE,
  markdownCellToNodes,
  markdownInlineToNodes,
} from "./to-rich-text";

/**
 * Editor JSON → GitHub-flavoured Markdown (DOC-12 export, DOC-14 handbook publish): the
 * inverse of `to-rich-text.ts`. Isomorphic and pure; output is deterministic and ends with
 * exactly one newline.
 *
 * Two steps, so the lossy decisions live in ONE place:
 *
 * 1. `normalizeForMarkdown(doc)` maps the doc onto what Markdown can say, in exactly the
 *    shape the importer produces (README "Markdown export" lists the lossy cases): mentions
 *    become `@Name`, attachments and diagram embeds become links, comment anchors and
 *    unknown marks are dropped, headings stop at level 3, and so on. Every inline run is
 *    printed and re-parsed with the importer's own parser; where CommonMark's emphasis rules
 *    would read it differently (e.g. bold that starts mid-word next to punctuation), the
 *    bold/italic/strike at those spots are dropped rather than emitting Markdown that means
 *    something else.
 * 2. `printMarkdown` prints a normalised doc.
 *
 * So `markdownToRichText(richTextToMarkdown(doc))` equals `normalizeForMarkdown(doc)` (up to
 * mark order), and exporting an imported file again is stable (both are tested).
 *
 * Safety: text is escaped so it never becomes markup; only `isSafeHref` links are written
 * (others keep their text); raw HTML is never emitted (the one exception is the fixed
 * `HQ_ONLY_LINKS_NOTE` comment, which the importer drops again).
 */

export interface MarkdownOptions {
  /** Project of the doc, for diagram embeds whose node lacks it (`/<KEY>/diagrams/<id>`). */
  projectKey?: string | null;
}

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

// ── Marks ───────────────────────────────────────────────────────────────────────────────

/** Canonical order: links outermost, code innermost (a code span is literal). */
const MARK_ORDER = ["link", "bold", "italic", "strike", "code"] as const;
/** Marks written with delimiter runs, which CommonMark's flanking rules apply to. */
const FLANK_MARKS = new Set<string>(["bold", "italic", "strike"]);

const OPEN: Record<string, string> = { bold: "**", italic: "*", strike: "~~", link: "[" };
const CLOSE: Record<string, string> = { bold: "**", italic: "*", strike: "~~" };

/** markdown-it's own link normalisation (percent-encoding, punycode), as the importer sees. */
function normalizeHref(href: string): string | null {
  const normalized = md.normalizeLink(href);
  return isSafeHref(normalized) ? normalized : null;
}

/** Known marks only, in canonical order. Code excludes everything but a link (like Tiptap). */
function normalizeMarks(marks: readonly RichTextMark[] | undefined): RichTextMark[] {
  const out: RichTextMark[] = [];
  for (const type of MARK_ORDER) {
    const mark = marks?.find((candidate) => candidate.type === type);
    if (!mark) continue;
    if (type === "link") {
      const raw = mark.attrs?.href;
      const href = isSafeHref(raw) ? normalizeHref(raw) : null;
      if (href) out.push({ type, attrs: { href } });
    } else {
      out.push({ type });
    }
  }
  return out.some((mark) => mark.type === "code")
    ? out.filter((mark) => mark.type === "code" || mark.type === "link")
    : out;
}

const markKey = (mark: RichTextMark) => canonicalJson(mark);

/** As markdown-it reads text: newlines in inline text are spaces, NUL is U+FFFD. */
const inlineText = (value: string) => value.replace(/\r\n?|\n/g, " ").replace(/\0/g, "\uFFFD");
const sameMarks = (a: readonly RichTextMark[] = [], b: readonly RichTextMark[] = []) =>
  a.length === b.length && a.every((mark, index) => markKey(mark) === markKey(b[index] ?? mark));
const hasMark = (marks: readonly RichTextMark[] | undefined, mark: RichTextMark) =>
  (marks ?? []).some((candidate) => markKey(candidate) === markKey(mark));
const flankTypes = (node: RichTextNode | undefined): Set<string> =>
  new Set(
    node?.type === "text"
      ? (node.marks ?? []).filter((mark) => FLANK_MARKS.has(mark.type)).map((mark) => mark.type)
      : [],
  );

function textNode(text: string, marks: readonly RichTextMark[] = []): RichTextNode {
  return marks.length > 0 ? { type: "text", text, marks: [...marks] } : { type: "text", text };
}

/** Sorts marks canonically (the importer orders them by nesting; order is not meaning). */
export function sortMarks<T extends RichTextNode>(node: T): T {
  const marks = node.marks
    ? [...node.marks].sort(
        (a, b) =>
          MARK_ORDER.indexOf(a.type as (typeof MARK_ORDER)[number]) -
          MARK_ORDER.indexOf(b.type as (typeof MARK_ORDER)[number]),
      )
    : undefined;
  return {
    ...node,
    ...(marks ? { marks } : {}),
    ...(node.content ? { content: node.content.map(sortMarks) } : {}),
  };
}

// ── Inline normalisation ────────────────────────────────────────────────────────────────

interface InlineContext {
  /** Hard breaks allowed (paragraphs); headings and table cells turn them into spaces. */
  breaks: boolean;
  cell?: boolean;
  heading?: boolean;
}

const INLINE_TYPES = new Set(["text", "hardBreak", USER_MENTION_NODE, FILE_NODE, UPLOAD_NODE]);

function flattenInline(nodes: readonly RichTextNode[], context: InlineContext): RichTextNode[] {
  const out: RichTextNode[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        // A text node holds no newlines in the editor; if one does, it reads as a space.
        out.push(textNode(inlineText(node.text ?? ""), normalizeMarks(node.marks)));
        break;
      case "hardBreak":
        out.push(context.breaks ? { type: "hardBreak" } : textNode(" "));
        break;
      case USER_MENTION_NODE:
        // @mentions are plain `@Name` in Markdown (the user id is HQ-only).
        out.push(
          textNode(inlineText(`@${mentionLabel(node) ?? "someone"}`), normalizeMarks(node.marks)),
        );
        break;
      case FILE_NODE: {
        const attrs = fileNodeAttrs(node.attrs);
        if (!attrs) break;
        const marks = normalizeMarks(node.marks).filter(
          (mark) => mark.type !== "link" && mark.type !== "code",
        );
        out.push(
          textNode(inlineText(attrs.filename), [
            { type: "link", attrs: { href: attachmentUrl(attrs.attachmentId) } },
            ...marks,
          ]),
        );
        break;
      }
      case UPLOAD_NODE:
        // An upload placeholder is never content (it is stripped before a save, too).
        break;
      default:
        if (node.content) out.push(...flattenInline(node.content, context));
        else {
          const text = inlineText(extractPlainText(node).replace(/\s*\n\s*/g, " "));
          if (text) out.push(textNode(text, normalizeMarks(node.marks)));
        }
    }
  }
  return out;
}

/** Drops empty text and merges neighbours with the same marks. */
function mergeText(nodes: readonly RichTextNode[]): RichTextNode[] {
  const out: RichTextNode[] = [];
  for (const node of nodes) {
    if (node.type === "text" && !node.text) continue;
    const last = out.at(-1);
    if (node.type === "text" && last?.type === "text" && sameMarks(last.marks, node.marks)) {
      out[out.length - 1] = textNode(`${last.text ?? ""}${node.text ?? ""}`, last.marks);
      continue;
    }
    out.push(node);
  }
  return out;
}

/**
 * CommonMark only reads `**`, `*` and `~~` as emphasis when they touch non-space text
 * ("**bold **" is literal). Whitespace at the edge where a bold/italic/strike starts or ends
 * moves out of that mark (it looks the same), so the delimiters always touch text.
 */
function moveEdgeWhitespace(input: readonly RichTextNode[]): RichTextNode[] {
  let nodes = mergeText(input);
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    const out: RichTextNode[] = [];
    nodes.forEach((node, index) => {
      const own = flankTypes(node);
      if (node.type !== "text" || own.size === 0) {
        out.push(node);
        return;
      }
      const before = flankTypes(nodes[index - 1]);
      const after = flankTypes(nodes[index + 1]);
      const opening = [...own].filter((type) => !before.has(type));
      const closing = [...own].filter((type) => !after.has(type));
      const text = node.text ?? "";
      const without = (types: string[]) =>
        (node.marks ?? []).filter((mark) => !types.includes(mark.type));
      const lead = opening.length > 0 ? (/^\s+/.exec(text)?.[0] ?? "") : "";
      if (lead === text) {
        out.push(textNode(text, without([...opening, ...closing])));
        changed ||= opening.length + closing.length > 0;
        return;
      }
      const trail = closing.length > 0 ? (/\s+$/.exec(text)?.[0] ?? "") : "";
      if (lead) out.push(textNode(lead, without(opening)));
      out.push(textNode(text.slice(lead.length, text.length - trail.length), node.marks));
      if (trail) out.push(textNode(trail, without(closing)));
      changed ||= lead !== "" || trail !== "";
    });
    nodes = mergeText(out);
    if (!changed) break;
  }
  return nodes;
}

/** Drops the bold/italic/strike that start or end inside a word (no space at the edge). */
function dropIntrawordFlanks(nodes: readonly RichTextNode[]): RichTextNode[] {
  const drop = nodes.map(() => new Set<string>());
  nodes.forEach((node, index) => {
    const next = nodes[index + 1];
    if (node.type !== "text" || next?.type !== "text") return;
    const a = flankTypes(node);
    const b = flankTypes(next);
    const differing = [...a, ...b].filter((type) => a.has(type) !== b.has(type));
    if (differing.length === 0) return;
    const tight = /\S$/.test(node.text ?? "") && /^\S/.test(next.text ?? "");
    if (!tight) return;
    for (const type of differing) {
      drop[index]?.add(type);
      drop[index + 1]?.add(type);
    }
  });
  return nodes.map((node, index) =>
    node.type === "text" && (drop[index]?.size ?? 0) > 0
      ? textNode(
          node.text ?? "",
          (node.marks ?? []).filter((mark) => !drop[index]?.has(mark.type)),
        )
      : node,
  );
}

const dropAllFlanks = (nodes: readonly RichTextNode[]) =>
  nodes.map((node) =>
    node.type === "text"
      ? textNode(
          node.text ?? "",
          (node.marks ?? []).filter((mark) => !FLANK_MARKS.has(mark.type)),
        )
      : node,
  );

/** Whether the printed Markdown reads back (importer's parser) as exactly these nodes. */
function readsBackAs(nodes: readonly RichTextNode[], context: InlineContext): boolean {
  const printed = printInline(nodes, { lineStart: false, ...context });
  const parsed = context.cell ? markdownCellToNodes(printed) : markdownInlineToNodes(printed);
  return canonicalJson(parsed.map(sortMarks)) === canonicalJson(nodes.map(sortMarks));
}

function normalizeInline(nodes: readonly RichTextNode[], context: InlineContext): RichTextNode[] {
  let flat = moveEdgeWhitespace(flattenInline(nodes, context));
  // A hard break at the end of a block is not Markdown (a trailing `\` is literal).
  while (flat.at(-1)?.type === "hardBreak") flat = flat.slice(0, -1);
  if (flat.length === 0) return [];
  for (const attempt of [
    (input: readonly RichTextNode[]) => [...input],
    dropIntrawordFlanks,
    dropAllFlanks,
  ]) {
    const candidate = moveEdgeWhitespace(attempt(flat));
    if (readsBackAs(candidate, context)) return candidate;
  }
  // Unreachable in practice (without delimiter runs everything is escaped); keep the
  // safest form rather than throwing on an export.
  return mergeText(dropAllFlanks(flat));
}

// ── Block normalisation ─────────────────────────────────────────────────────────────────

const paragraphOf = (content: RichTextNode[]): RichTextNode =>
  content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };

/** Containers that must hold a block: an empty one gets an empty paragraph. */
const atLeastOne = (blocks: RichTextNode[]) => (blocks.length > 0 ? blocks : [paragraphOf([])]);

const CODE_LANGUAGE = /^[A-Za-z0-9_+#.-]{1,32}$/;
const MAX_ORDERED_START = 999_999_999;

function codeText(node: RichTextNode): string {
  return (node.content ?? [])
    .map((child) => child.text ?? "")
    .join("")
    .replace(/\r\n?/g, "\n")
    .replace(/\0/g, "\uFFFD");
}

function linkParagraph(text: string, href: string | null): RichTextNode[] {
  const content = normalizeInline(
    [textNode(text, href ? [{ type: "link", attrs: { href } }] : [])],
    { breaks: true },
  );
  return content.length > 0 ? [paragraphOf(content)] : [];
}

function normalizeItem(item: RichTextNode, type: "listItem" | "taskItem", options: Options) {
  const blocks = normalizeBlocks(item.content ?? [], options);
  // Tiptap list items start with a paragraph (the importer adds an empty one too).
  const content = blocks[0]?.type === "paragraph" ? blocks : [paragraphOf([]), ...blocks];
  return type === "taskItem"
    ? { type, attrs: { checked: item.attrs?.checked === true }, content }
    : { type, content };
}

/** GFM tables: one paragraph per cell (other blocks become their text), the first row is the
 * header, short rows are padded. Cell spans and a header column are not Markdown. */
function normalizeTable(node: RichTextNode): RichTextNode[] {
  const rows = (node.content ?? [])
    .filter((row) => row.type === "tableRow")
    .map((row) =>
      (row.content ?? []).filter(
        (cell) => cell.type === "tableCell" || cell.type === "tableHeader",
      ),
    );
  const columns = Math.max(0, ...rows.map((cells) => cells.length));
  if (rows.length === 0 || columns === 0) return [];
  return [
    {
      type: "table",
      content: rows.map((cells, rowIndex) => ({
        type: "tableRow",
        content: Array.from({ length: columns }, (_, column) => {
          // GFM: the first row is the header row, every other row holds body cells.
          const type = rowIndex === 0 ? "tableHeader" : "tableCell";
          const parts = (cells[column]?.content ?? []).map((block) =>
            block.type === "paragraph" || block.type === "heading"
              ? (block.content ?? [])
              : [textNode(inlineText(extractPlainText(block).replace(/\s*\n\s*/g, " ")))],
          );
          const inline = parts
            .filter((part) => part.length > 0)
            .flatMap((part, index) => (index > 0 ? [textNode(" "), ...part] : part));
          return {
            type,
            content: [paragraphOf(normalizeInline(inline, { breaks: false, cell: true }))],
          };
        }),
      })),
    },
  ];
}

interface Options {
  projectKey: string | null;
}

function normalizeBlock(node: RichTextNode, options: Options): RichTextNode[] {
  const content = node.content ?? [];
  switch (node.type) {
    case "paragraph": {
      const inline = normalizeInline(content, { breaks: true });
      return inline.length > 0 ? [paragraphOf(inline)] : [];
    }
    case "heading": {
      const raw = Number(node.attrs?.level);
      // The importer reads h4–h6 as level 3 (the editor offers 1–3).
      const level = Number.isInteger(raw) ? Math.min(3, Math.max(1, raw)) : 1;
      const inline = normalizeInline(content, { breaks: false, heading: true });
      return [
        inline.length > 0
          ? { type: "heading", attrs: { level }, content: inline }
          : { type: "heading", attrs: { level } },
      ];
    }
    case "blockquote":
      // Mirrors the importer: a quote starting with a bold "Note:" reads back as a callout.
      return [
        asCallout({ type: "blockquote", content: atLeastOne(normalizeBlocks(content, options)) }),
      ];
    case "callout":
      return [
        {
          type: "callout",
          attrs: { tone: node.attrs?.tone === "warning" ? "warning" : "info" },
          content: atLeastOne(normalizeBlocks(content, options)),
        },
      ];
    case "bulletList":
    case "taskList":
    case "orderedList": {
      const itemType = node.type === "taskList" ? "taskItem" : "listItem";
      const items = content
        .filter((item) => item.type === "listItem" || item.type === "taskItem")
        .map((item) => normalizeItem(item, itemType, options));
      if (items.length === 0) return [];
      if (node.type === "orderedList") {
        const start = Number(node.attrs?.start ?? 1);
        // CommonMark markers have at most 9 digits: the LAST item's number must fit too.
        const valid =
          Number.isInteger(start) && start >= 0 && start + items.length - 1 <= MAX_ORDERED_START;
        return [
          valid && start !== 1
            ? { type: "orderedList", attrs: { start }, content: items }
            : { type: "orderedList", content: items },
        ];
      }
      // Mirrors the importer: a bullet list whose items all start with "[ ] " is a task list.
      return [
        node.type === "taskList"
          ? { type: "taskList", content: items }
          : asTaskList({ type: "bulletList", content: items }),
      ];
    }
    case "listItem":
    case "taskItem":
      return normalizeBlocks(content, options);
    case "codeBlock": {
      const raw = node.attrs?.language;
      const language = typeof raw === "string" && CODE_LANGUAGE.test(raw) ? raw : null;
      const text = codeText(node);
      // A ```mermaid fence is a Mermaid block on import.
      if (language?.toLowerCase() === "mermaid")
        return [{ type: "mermaid", attrs: { source: text } }];
      return [
        text
          ? { type: "codeBlock", attrs: { language }, content: [textNode(text)] }
          : { type: "codeBlock", attrs: { language } },
      ];
    }
    case "mermaid": {
      const source = typeof node.attrs?.source === "string" ? node.attrs.source : "";
      return [
        {
          type: "mermaid",
          attrs: { source: source.replace(/\r\n?/g, "\n").replace(/\0/g, "\uFFFD") },
        },
      ];
    }
    case "horizontalRule":
      return [{ type: "horizontalRule" }];
    case "table":
      return normalizeTable(node);
    case IMAGE_NODE: {
      const attrs = imageNodeAttrs(node.attrs);
      return attrs
        ? linkParagraph(attrs.alt.trim() || "image", attachmentUrl(attrs.attachmentId))
        : [];
    }
    case DIAGRAM_EMBED_NODE: {
      const attrs = diagramEmbedAttrs(node);
      if (!attrs.diagramId) return [];
      const key = attrs.projectKey ?? options.projectKey;
      return linkParagraph(
        `Diagram: ${attrs.title.trim() || "Untitled"}`,
        key ? `/${key}/diagrams/${attrs.diagramId}` : null,
      );
    }
    case UPLOAD_NODE:
      return [];
    default: {
      // An unknown block: keep its children, or its plain text, never its markup.
      if (node.content) return normalizeBlocks(content, options);
      const text = extractPlainText(node);
      return text ? normalizeBlock({ type: "paragraph", content: [textNode(text)] }, options) : [];
    }
  }
}

function normalizeBlocks(nodes: readonly RichTextNode[], options: Options): RichTextNode[] {
  const out: RichTextNode[] = [];
  let inline: RichTextNode[] = [];
  const flush = () => {
    if (inline.length > 0)
      out.push(...normalizeBlock({ type: "paragraph", content: inline }, options));
    inline = [];
  };
  for (const node of nodes) {
    // Stray inline nodes at block level read as a paragraph.
    if (INLINE_TYPES.has(node.type)) {
      inline.push(node);
      continue;
    }
    flush();
    out.push(...normalizeBlock(node, options));
  }
  flush();
  return out;
}

/**
 * The doc as Markdown can hold it, in the importer's shape: what
 * `markdownToRichText(richTextToMarkdown(doc))` returns (up to mark order, see `sortMarks`).
 */
export function normalizeForMarkdown(
  doc: RichTextNode,
  options: MarkdownOptions = {},
): RichTextDoc {
  const projectKey =
    options.projectKey && PROJECT_KEY_PATTERN.test(options.projectKey) ? options.projectKey : null;
  // Mirrors the importer, which drops a top-level paragraph that is exactly the note.
  const blocks = normalizeBlocks(doc.content ?? [], { projectKey }).filter(
    (node) =>
      !(
        node.type === "paragraph" &&
        node.content?.length === 1 &&
        node.content[0]?.text === HQ_ONLY_LINKS_NOTE &&
        !node.content[0].marks
      ),
  );
  return { type: "doc", content: atLeastOne(blocks) };
}

// ── Printing ────────────────────────────────────────────────────────────────────────────

interface PrintContext {
  /** Escape what would start a block at the start of a line (paragraphs, list items). */
  lineStart: boolean;
  cell?: boolean;
  heading?: boolean;
}

const ENTITY = /^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;
const ALNUM = /^[\p{L}\p{N}]$/u;

/** Backslash-escapes what markdown-it or GitHub would read as syntax inside a line. GitHub
 * also reads a single `~x~` as strikethrough and `$x$` as math, so both are always escaped. */
function escapeText(text: string, context: PrintContext): string {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    const prev = text.charAt(index - 1);
    const next = text.charAt(index + 1);
    if ("\\`*[]<|~$".includes(char)) out += `\\${char}`;
    // `_` between two letters/digits is never emphasis (snake_case stays readable).
    else if (char === "_") out += ALNUM.test(prev) && ALNUM.test(next) ? "_" : "\\_";
    else if (char === "&") out += ENTITY.test(text.slice(index)) ? "\\&" : "&";
    // `!` right before a link's `[` would make it an image.
    else if (char === "!" && index === text.length - 1) out += "\\!";
    // A trailing `#` run would be an ATX closing sequence; escape them all in headings.
    else if (char === "#" && context.heading) out += "\\#";
    else out += char;
  }
  return out;
}

/** At the start of a line: `# `, `- `, `+ `, `= `, `> `, `1. ` would start a block, and a
 * line starting with `:` (after `-`/`|`, already escaped) could be a table delimiter row
 * under a line holding a pipe (tables may interrupt a paragraph). */
function escapeLineStart(escaped: string): string {
  if (/^[#\-+=>:]/.test(escaped)) return `\\${escaped}`;
  return escaped.replace(/^(\d{1,9})([.)])/, "$1\\$2");
}

/** Whitespace that markdown-it would trim (line edges) as numeric entities. */
const encodeSpaces = (spaces: string) =>
  [...spaces].map((char) => `&#${char.codePointAt(0) ?? 32};`).join("");

function codeSpan(text: string, context: PrintContext): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad =
    text.startsWith("`") ||
    text.endsWith("`") ||
    (text.startsWith(" ") && text.endsWith(" ") && text.trim() !== "")
      ? " "
      : "";
  // GFM: a pipe inside a code span in a table cell must still be escaped.
  const body = context.cell ? text.replace(/\|/g, "\\|") : text;
  return `${fence}${pad}${body}${pad}${fence}`;
}

const linkDestination = (href: string) => href.replace(/[()]/g, "\\$&");

/** How many nodes from `from` on carry `mark` without a break (to nest longer marks outside). */
function runLength(nodes: readonly RichTextNode[], from: number, mark: RichTextMark): number {
  let count = 0;
  for (let index = from; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node?.type !== "text" || !hasMark(node.marks, mark)) break;
    count += 1;
  }
  return count;
}

function printInline(nodes: readonly RichTextNode[], context: PrintContext): string {
  let out = "";
  const stack: RichTextMark[] = [];
  let lineStart = context.lineStart;
  const closeTo = (depth: number) => {
    while (stack.length > depth) {
      const mark = stack.pop();
      if (!mark) break;
      out +=
        mark.type === "link"
          ? `](${linkDestination(String(mark.attrs?.href ?? ""))})`
          : (CLOSE[mark.type] ?? "");
    }
  };
  nodes.forEach((node, index) => {
    if (node.type === "hardBreak") {
      // Marks close before a break and reopen after it, so delimiters never span lines.
      closeTo(0);
      out += "\\\n";
      // The next line could start a block (a list, a quote …) in any container.
      lineStart = true;
      return;
    }
    const marks = node.marks ?? [];
    let keep = 0;
    while (keep < stack.length && hasMark(marks, stack[keep] ?? { type: "" })) keep += 1;
    closeTo(keep);
    const opening = marks
      .filter((mark) => mark.type !== "code" && !hasMark(stack, mark))
      .sort(
        (a, b) =>
          runLength(nodes, index, b) - runLength(nodes, index, a) ||
          MARK_ORDER.indexOf(a.type as (typeof MARK_ORDER)[number]) -
            MARK_ORDER.indexOf(b.type as (typeof MARK_ORDER)[number]),
      );
    for (const mark of opening) {
      out += OPEN[mark.type] ?? "";
      stack.push(mark);
    }
    const text = node.text ?? "";
    const atLineEdge = out === "" || out.endsWith("\n");
    if (marks.some((mark) => mark.type === "code")) {
      out += codeSpan(text, context);
    } else {
      const lead = atLineEdge ? (/^\s+/.exec(text)?.[0] ?? "") : "";
      const next = nodes[index + 1];
      const endsLine = (!next || next.type === "hardBreak") && marks.length === 0;
      const trail = endsLine ? (/\s+$/.exec(text.slice(lead.length))?.[0] ?? "") : "";
      const core = text.slice(lead.length, text.length - trail.length);
      let escaped = escapeText(core, context);
      if (lineStart && atLineEdge && !lead) escaped = escapeLineStart(escaped);
      out += `${encodeSpaces(lead)}${escaped}${encodeSpaces(trail)}`;
    }
    lineStart = false;
  });
  closeTo(0);
  return out;
}

const indentLines = (text: string, indent: string) =>
  text
    .split("\n")
    .map((line) => (line === "" ? "" : `${indent}${line}`))
    .join("\n");

const quoteLines = (text: string) =>
  text
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");

function fenced(info: string, code: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return code === "" ? `${fence}${info}\n${fence}` : `${fence}${info}\n${code}\n${fence}`;
}

const isList = (node: RichTextNode | undefined) =>
  node?.type === "bulletList" || node?.type === "taskList" || node?.type === "orderedList";

/** A nested list that may follow its item's paragraph without a blank line: it must be
 * able to interrupt a paragraph (CommonMark: not empty, and numbered lists start at 1). */
function interruptsParagraph(node: RichTextNode | undefined): boolean {
  if (!isList(node)) return false;
  if (node?.type === "orderedList" && node.attrs?.start !== undefined) return false;
  const first = node?.content?.[0]?.content?.[0];
  return node?.type === "taskList" || (first?.content?.length ?? 0) > 0;
}

function printList(node: RichTextNode, alternate: boolean): string {
  const ordered = node.type === "orderedList";
  const task = node.type === "taskList";
  const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
  const items = (node.content ?? []).map((item, index) => {
    const marker = ordered ? `${start + index}${alternate ? ")" : "."}` : alternate ? "*" : "-";
    const indent = " ".repeat(marker.length + 1);
    const [first, ...rest] = item.content ?? [];
    const inline = first?.content ?? [];
    let head: string;
    if (task) {
      const box = `${marker} [${item.attrs?.checked === true ? "x" : " "}]`;
      // `[ ]&#32;`: an empty task keeps its box (markdown-it trims a trailing space).
      head =
        inline.length > 0 ? `${box} ${printInline(inline, { lineStart: false })}` : `${box}&#32;`;
    } else {
      head = inline.length > 0 ? `${marker} ${printInline(inline, { lineStart: true })}` : marker;
    }
    if (rest.length === 0) return { text: head, tight: true };
    const tight = rest.length === 1 && interruptsParagraph(rest[0]);
    const body = indentLines(printBlocks(rest).join("\n\n"), indent);
    // An empty item's content starts on the next line (one blank line would end the item).
    const separator = inline.length === 0 && !task ? "\n" : tight ? "\n" : "\n\n";
    return { text: `${head}${separator}${body}`, tight };
  });
  return items.map((item) => item.text).join(items.every((item) => item.tight) ? "\n" : "\n\n");
}

function printTable(node: RichTextNode): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      printInline(cell.content?.[0]?.content ?? [], { lineStart: false, cell: true }),
    ),
  );
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const [header = [], ...body] = rows;
  return [line(header), line(header.map(() => "---")), ...body.map(line)].join("\n");
}

function printBlock(node: RichTextNode, alternate: boolean): string {
  const content = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return printInline(content, { lineStart: true });
    case "heading": {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
      const hashes = "#".repeat(level);
      return content.length > 0
        ? `${hashes} ${printInline(content, { lineStart: false, heading: true })}`
        : hashes;
    }
    case "blockquote":
      return quoteLines(printBlocks(content).join("\n\n"));
    case "callout": {
      const label = `**${node.attrs?.tone === "warning" ? CALLOUT_LABELS.warning : CALLOUT_LABELS.info}**`;
      const [first, ...rest] = content;
      const blocks =
        first?.type === "paragraph" && (first.content?.length ?? 0) > 0
          ? [
              `${label} ${printInline(first.content ?? [], { lineStart: false })}`,
              ...printBlocks(rest),
            ]
          : [label, ...printBlocks(first?.type === "paragraph" ? rest : content)];
      return quoteLines(blocks.join("\n\n"));
    }
    case "bulletList":
    case "taskList":
    case "orderedList":
      return printList(node, alternate);
    case "codeBlock": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      return fenced(language, codeText(node));
    }
    case "mermaid":
      return fenced("mermaid", typeof node.attrs?.source === "string" ? node.attrs.source : "");
    case "horizontalRule":
      return "---";
    case "table":
      return printTable(node);
    default:
      return "";
  }
}

/** Blocks of one container; two lists of the same kind in a row alternate their markers
 * (`-`/`*`, `.`/`)`), or Markdown would read them as one list. */
function printBlocks(nodes: readonly RichTextNode[]): string[] {
  let previous: "bullet" | "ordered" | null = null;
  let alternate = false;
  return nodes.map((node) => {
    const kind = node.type === "orderedList" ? "ordered" : isList(node) ? "bullet" : null;
    alternate = kind !== null && kind === previous ? !alternate : false;
    previous = kind;
    return printBlock(node, alternate);
  });
}

/** Root-relative links into HQ: `/api/…` (attachments) and `/<KEY>…` (diagrams, docs, issues). */
const HQ_ONLY_HREF = /^\/(?:api\/|[A-Z]{2,5}(?:[/?#]|$))/;

function linksIntoHq(node: RichTextNode): boolean {
  return (
    (node.marks ?? []).some(
      (mark) => mark.type === "link" && HQ_ONLY_HREF.test(String(mark.attrs?.href ?? "")),
    ) || (node.content ?? []).some(linksIntoHq)
  );
}

/** Prints a doc already normalised by `normalizeForMarkdown`. */
export function printMarkdown(doc: RichTextDoc): string {
  const blocks = printBlocks(doc.content ?? []).filter((block) => block !== "");
  // Attachment and diagram links need an HQ session; say so once, invisibly on GitHub.
  if (linksIntoHq(doc)) blocks.push(HQ_ONLY_LINKS_NOTE);
  return `${blocks.join("\n\n")}\n`;
}

/** Editor JSON → GitHub-flavoured Markdown (see the module comment). */
export function richTextToMarkdown(doc: RichTextNode, options: MarkdownOptions = {}): string {
  return printMarkdown(normalizeForMarkdown(doc, options));
}
