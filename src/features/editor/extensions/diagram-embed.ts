import { Network } from "lucide-react";

import { DIAGRAM_EMBED_NODE } from "@/lib/rich-text-nodes/diagram-embed";

import { DiagramEmbed } from "../diagram-embed-node";

import { type EditorFeature } from "./types";

/** DOC-8 "Insert diagram": a live HQ diagram (thumbnail + title) in a doc. Docs only. */
export const diagramEmbedFeature: EditorFeature = {
  name: DIAGRAM_EMBED_NODE,
  variants: ["doc"],
  extensions: () => [DiagramEmbed],
  insertButtons: [
    {
      label: "Insert diagram",
      icon: Network,
      isActive: (e) => e.isActive(DIAGRAM_EMBED_NODE),
      run: (e) => e.chain().focus().insertDiagramEmbed().run(),
    },
  ],
};
