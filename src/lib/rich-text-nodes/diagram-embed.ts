import { DIAGRAM_KINDS, type DiagramKind } from "@/lib/diagrams/constants";
import { isUuid } from "@/lib/diagrams/links";
import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import { type RichTextNode } from "@/lib/rich-text";

import { type PlainTextRules } from "./types";

/**
 * DOC-8 `diagramEmbed` node: `{ diagramId, title, projectKey, kind }`. `diagramId` is the
 * reference; the title, project and kind are what the diagram was called when it was
 * embedded, kept so the plain text (search) and the read-only view need no lookup. The
 * thumbnail is always the live one.
 */
export const DIAGRAM_EMBED_NODE = "diagramEmbed";

export interface DiagramEmbedAttrs {
  diagramId: string | null;
  title: string;
  projectKey: string | null;
  kind: DiagramKind | null;
}

/** The node's attrs, each validated (anything malformed reads as absent). */
export function diagramEmbedAttrs(node: Pick<RichTextNode, "attrs">): DiagramEmbedAttrs {
  const attrs = node.attrs ?? {};
  const title = typeof attrs.title === "string" ? attrs.title.slice(0, 255) : "";
  const kind = DIAGRAM_KINDS.find((value) => value === attrs.kind) ?? null;
  return {
    diagramId: isUuid(attrs.diagramId) ? attrs.diagramId.toLowerCase() : null,
    title,
    projectKey:
      typeof attrs.projectKey === "string" && PROJECT_KEY_PATTERN.test(attrs.projectKey)
        ? attrs.projectKey
        : null,
    kind,
  };
}

/**
 * Each embed is its own line, contributing the diagram's title (searchable). It counts as
 * code, so a key in a diagram's title (`STK-12 upload flow`) does not become a mention.
 */
export const diagramEmbedPlainText: PlainTextRules = {
  [DIAGRAM_EMBED_NODE]: {
    block: true,
    code: true,
    text: (node) => {
      const { diagramId, title } = diagramEmbedAttrs(node);
      return diagramId ? title || "Diagram" : "";
    },
  },
};
