import { type DiagramKind } from "./constants";
import { type DiagramScene } from "./scene";

/** Read models of the diagram pages (DGM-*). Isomorphic. */

/** A card of the §5.6 list grid. */
export interface DiagramCard {
  id: string;
  kind: DiagramKind;
  title: string;
  position: string;
  ownerName: string | null;
  updatedAt: Date;
  hasThumbnail: boolean;
}

export interface DiagramDetail {
  id: string;
  projectKey: string;
  kind: DiagramKind;
  title: string;
  scene: DiagramScene;
  version: number;
  ownerName: string | null;
  updatedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  hasThumbnail: boolean;
}

/** DGM-4 history entry (newest first). */
export interface DiagramVersionView {
  version: number;
  title: string;
  authorName: string | null;
  createdAt: Date;
}

/** A version's scene, for the read-only preview and restore. */
export interface DiagramVersionScene extends DiagramVersionView {
  kind: DiagramKind;
  scene: DiagramScene;
}

/**
 * "Linked" panel entry. `manual` links are stored from the diagram (removable here);
 * `embed` rows are docs whose body embeds the diagram (computed from the doc content);
 * `incoming` are links other things store to the diagram.
 */
export interface DiagramLinkView {
  key: string;
  linkId: string | null;
  kind: "issue" | "doc";
  source: "manual" | "embed" | "incoming";
  label: string;
  href: string;
}

export interface DiagramTemplateView {
  id: string;
  kind: DiagramKind;
  name: string;
  description: string | null;
}

/** "Insert diagram" picker option (DOC-8). */
export interface DiagramOption {
  id: string;
  title: string;
  kind: DiagramKind;
  projectKey: string;
}
