import { richTextToMarkdown } from "@/lib/markdown/from-rich-text";
import { extractPlainText, type RichTextNode } from "@/lib/rich-text";

import { adrTitle, formatAdrNumber, splitAdrTitle } from "./adr";
import { type AdrStatus, type DocType } from "./constants";
import { handbookFileName, handbookPathFor, handbookRelativeLink } from "./handbook-path";

/**
 * A doc as a handbook Markdown file (DOC-12 export, DOC-14 publish). Isomorphic and pure.
 *
 * The file starts with `# Title` (the importer takes it back as the title, `takeTitle`).
 * ADRs follow `decisions/0000-template.md`: the title is `# NNNN. Title`, and the first
 * paragraph of `## Status` starts with the status from `adr_status` / `adr_superseded_by`
 * ("`Accepted`.", "`Accepted (recorded retrospectively)`.", "Superseded by
 * [NNNN](NNNN-slug.md)."), replacing whatever status text the paragraph started with, so the
 * columns (not stale text) win. The rest of that paragraph ("Recorded against …") stays.
 * `parseAdrStatus` reads every one of these back to the same status.
 */

export interface MarkdownExportDoc {
  type: DocType;
  title: string;
  content: RichTextNode | null;
  projectKey: string;
  adrNumber: number | null;
  adrStatus: AdrStatus | null;
  handbookPath?: string | null;
  sourcePath?: string | null;
  /** The live ADR that supersedes this one, if any (`adr_superseded_by`). */
  supersededBy?: {
    title: string;
    adrNumber: number | null;
    handbookPath?: string | null;
    sourcePath?: string | null;
  } | null;
}

export interface MarkdownExport {
  /** Repo path (`handbookPathFor`). */
  path: string;
  /** Its basename, for `Content-Disposition`. */
  fileName: string;
  markdown: string;
}

const STATUS_LABELS: Record<Exclude<AdrStatus, "superseded">, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  accepted_retrospective: "Accepted (recorded retrospectively)",
  deprecated: "Deprecated",
};

/** A leading status phrase, as `parseAdrStatus` reads one (plus its closing punctuation). */
const STATUS_PREFIX =
  /^\s*(?:superseded\s+by\s*(?:adr[- ]?)?\d{1,6}|superseded|accepted\s*\(\s*recorded retrospectively\s*\)|accepted|deprecated|proposed)\s*[.,;:]?\s*/i;

const text = (value: string, marks?: RichTextNode["marks"]): RichTextNode =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };

function statusNodes(doc: MarkdownExportDoc, path: string): RichTextNode[] {
  const target = doc.supersededBy;
  if (doc.adrStatus === "superseded" && target && target.adrNumber !== null) {
    const targetPath = handbookPathFor({ ...target, type: "adr" });
    return [
      text("Superseded by "),
      text(formatAdrNumber(target.adrNumber), [
        { type: "link", attrs: { href: handbookRelativeLink(path, targetPath) } },
      ]),
      text("."),
    ];
  }
  const label =
    doc.adrStatus === "superseded" ? "Superseded" : STATUS_LABELS[doc.adrStatus ?? "proposed"];
  return [text(label, [{ type: "code" }]), text(".")];
}

/** Drops the first `length` characters of a paragraph's leading text nodes. */
function dropLeadingText(inline: RichTextNode[], length: number): RichTextNode[] {
  let remaining = length;
  const out: RichTextNode[] = [];
  for (const node of inline) {
    if (remaining > 0 && node.type === "text") {
      const value = node.text ?? "";
      if (value.length <= remaining) {
        remaining -= value.length;
        continue;
      }
      out.push({ ...node, text: value.slice(remaining) });
      remaining = 0;
      continue;
    }
    out.push(node);
  }
  return out;
}

/** The leading text of a paragraph, up to its first non-text node. */
function leadingText(inline: RichTextNode[]): string {
  let out = "";
  for (const node of inline) {
    if (node.type !== "text") break;
    out += node.text ?? "";
  }
  return out;
}

const isStatusHeading = (node: RichTextNode) =>
  node.type === "heading" && extractPlainText(node).trim().toLowerCase() === "status";

/** The ADR content with its Status paragraph rewritten from the columns. */
function withAdrStatus(blocks: RichTextNode[], status: RichTextNode[]): RichTextNode[] {
  const heading = blocks.findIndex(isStatusHeading);
  if (heading < 0) {
    return [
      { type: "heading", attrs: { level: 2 }, content: [text("Status")] },
      { type: "paragraph", content: status },
      ...blocks,
    ];
  }
  const next = blocks[heading + 1];
  const out = [...blocks];
  if (next?.type === "paragraph") {
    const inline = next.content ?? [];
    const match = STATUS_PREFIX.exec(leadingText(inline));
    if (match) {
      const rest = dropLeadingText(inline, match[0].length);
      out[heading + 1] = {
        type: "paragraph",
        content: rest.length > 0 ? [...status, text(" "), ...rest] : status,
      };
      return out;
    }
  }
  out.splice(heading + 1, 0, { type: "paragraph", content: status });
  return out;
}

export function docToMarkdown(doc: MarkdownExportDoc): MarkdownExport {
  const path = handbookPathFor(doc);
  const isAdr = doc.type === "adr" && doc.adrNumber !== null;
  const title = isAdr
    ? adrTitle(doc.adrNumber ?? 0, splitAdrTitle(doc.title)?.title ?? doc.title)
    : doc.title;
  const blocks = doc.content?.content ?? [];
  const body = isAdr ? withAdrStatus(blocks, statusNodes(doc, path)) : blocks;
  const markdown = richTextToMarkdown(
    {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1 }, content: [text(title)] }, ...body],
    },
    { projectKey: doc.projectKey },
  );
  return { path, fileName: handbookFileName(path), markdown };
}
