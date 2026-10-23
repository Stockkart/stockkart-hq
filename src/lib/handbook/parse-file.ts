import { adrTitle, parseAdrStatus, splitAdrTitle } from "@/lib/docs/adr";
import { type AdrStatus, type DocType } from "@/lib/docs/constants";
import { DOC_TITLE_MAX } from "@/lib/docs/schemas";
import { markdownToRichText, sectionText, takeTitle } from "@/lib/markdown/to-rich-text";
import { type RichTextDoc, richTextDocSchema } from "@/lib/rich-text";

/**
 * A handbook file read back into an existing doc (DOC-14 pull), as the importer reads it
 * (IMP-1/2): `# Title` becomes the title, ADRs keep their HQ number and take the status
 * (and "Superseded by NNNN") from `## Status`. Isomorphic and pure.
 */
export interface PulledFile {
  title: string;
  content: RichTextDoc;
  /** ADRs only; null `status` = no recognised status (the doc keeps its own). */
  adr: { status: AdrStatus | null; supersededByNumber: number | null } | null;
}

export function parsePulledFile(
  doc: { type: DocType; title: string; adrNumber: number | null },
  markdown: string,
): PulledFile | null {
  const { title, doc: body } = takeTitle(markdownToRichText(markdown));
  const parsed = richTextDocSchema.safeParse(body);
  if (!parsed.success) return null;
  const content = parsed.data;
  if (doc.type === "adr" && doc.adrNumber !== null) {
    // The number is HQ's (unique per project); a different number in the heading is ignored.
    const heading = title ? splitAdrTitle(title) : null;
    const name = (heading?.title || title || splitAdrTitle(doc.title)?.title || doc.title).slice(
      0,
      DOC_TITLE_MAX - 6,
    );
    const statusText = sectionText(content, "Status");
    const status = statusText === null ? null : parseAdrStatus(statusText);
    return {
      title: adrTitle(doc.adrNumber, name),
      content,
      adr: {
        status: status?.status ?? null,
        supersededByNumber: status?.supersededBy ?? null,
      },
    };
  }
  const clean = (title ?? doc.title).replace(/\s+/g, " ").trim().slice(0, DOC_TITLE_MAX);
  return { title: clean || doc.title, content, adr: null };
}

/** A repo file "New in handbook" may import: top level or `decisions/NNNN-*.md`, not the template. */
export function isImportableHandbookFile(path: string): boolean {
  if (!path.includes("/")) return path.endsWith(".md");
  const match = /^decisions\/(\d{4})-[^/]+\.md$/.exec(path);
  return match?.[1] !== undefined && Number(match[1]) !== 0;
}
