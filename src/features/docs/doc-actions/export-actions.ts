import { toast } from "sonner";

import { splitAdrTitle } from "@/lib/docs/adr";

import { type DocAction, type DocActionContext } from "./types";

/**
 * DOC-12 from the "⋯" menu: download the doc's handbook file (the export route, which reads
 * the saved doc), or copy the same Markdown, built here with `docToMarkdown` (and so
 * `richTextToMarkdown`) from the copy on screen.
 */

export function exportHref(context: DocActionContext): string {
  return `/${context.doc.projectKey}/docs/${context.doc.id}/export`;
}

/** The Markdown of the doc on screen, as the export route would write it. */
export async function currentMarkdown(context: DocActionContext): Promise<string> {
  // The serializer (markdown-it) loads only when it is used.
  const { docToMarkdown } = await import("@/lib/docs/markdown-export");
  const { doc } = context;
  const { title, content } = context.current();
  const successor = doc.adrSupersededBy;
  return docToMarkdown({
    type: doc.type,
    title,
    content,
    projectKey: doc.projectKey,
    adrNumber: doc.adrNumber,
    adrStatus: doc.adrStatus,
    supersededBy: successor
      ? { title: successor.title, adrNumber: splitAdrTitle(successor.title)?.number ?? null }
      : null,
  }).markdown;
}

export const downloadMarkdownAction: DocAction = {
  id: "download-markdown",
  label: "Download as Markdown",
  async run(context) {
    // The route exports the saved doc, so save pending edits first.
    if (!(await context.flush())) {
      toast.error("Your latest changes are not saved yet; the file has the last saved version.");
    }
    context.download(exportHref(context));
  },
};

export const copyMarkdownAction: DocAction = {
  id: "copy-markdown",
  label: "Copy as Markdown",
  async run(context) {
    try {
      await context.copyText(currentMarkdown(context));
      toast.success("Copied as Markdown");
    } catch {
      toast.error("Could not copy. Use “Download as Markdown” instead.");
    }
  },
};
