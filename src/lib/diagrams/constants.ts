/**
 * Diagram vocabulary (SPEC §4.13 DGM-1…7). Isomorphic.
 */

/** DGM-1 Excalidraw whiteboards and DGM-2 React Flow flows. */
export const DIAGRAM_KINDS = ["whiteboard", "flow"] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];

/**
 * Upper bound of a stored scene, in bytes of its JSON text (§7.3 expects 50–500 KB). The
 * database enforces it with a CHECK on `octet_length(scene::text)`, so validate input against
 * the same number before writing. Embedded images live in R2, never in the scene.
 */
export const DIAGRAM_SCENE_MAX_BYTES = 2 * 1024 * 1024;
