import Link from "next/link";

import { DiagramThumbnail } from "@/features/diagrams/diagram-thumbnail";
import { DIAGRAM_KIND_LABELS } from "@/lib/diagrams/constants";
import { diagramPath } from "@/lib/diagrams/links";
import { DIAGRAM_EMBED_NODE, diagramEmbedAttrs } from "@/lib/rich-text-nodes/diagram-embed";

import { type NodeRenderers } from "./types";

/**
 * DOC-8 in the read-only view: the live thumbnail and the title, linking to the diagram.
 * Every attr is validated (`diagramEmbedAttrs`); the link is built from them, never taken
 * from the stored JSON.
 */
export const diagramEmbedRenderers: NodeRenderers = {
  [DIAGRAM_EMBED_NODE]: ({ node, index }) => {
    const { diagramId, title, projectKey, kind } = diagramEmbedAttrs(node);
    if (!diagramId || !projectKey) return null;
    const label = title || "Diagram";
    return (
      <figure key={index} data-type={DIAGRAM_EMBED_NODE} className="not-prose my-3 max-w-md">
        <Link
          href={diagramPath(projectKey, diagramId)}
          className="flex flex-col gap-1 rounded-md outline-none hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <DiagramThumbnail diagramId={diagramId} kind={kind} />
          <figcaption className="text-sm">
            <span className="font-medium">{label}</span>
            {kind ? (
              <span className="text-xs text-muted-foreground"> · {DIAGRAM_KIND_LABELS[kind]}</span>
            ) : null}
          </figcaption>
        </Link>
      </figure>
    );
  },
};
