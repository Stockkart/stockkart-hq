/**
 * Diagram vocabulary (SPEC §4.13 DGM-1…7). Isomorphic.
 */

/** DGM-1 Excalidraw whiteboards and DGM-2 React Flow flows. */
export const DIAGRAM_KINDS = ["whiteboard", "flow"] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];

export const DIAGRAM_KIND_LABELS: Record<DiagramKind, string> = {
  whiteboard: "Whiteboard",
  flow: "Flow",
};

/**
 * Upper bound of a stored scene, in bytes of its JSON text (§7.3 expects 50–500 KB). The
 * database enforces it with a CHECK on `octet_length(scene::text) < DIAGRAM_SCENE_MAX_BYTES`,
 * so a scene AT the limit is refused. Embedded images live in R2, never in the scene.
 */
export const DIAGRAM_SCENE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * What the app accepts, measured as UTF-8 bytes of `JSON.stringify(scene)`. Postgres prints
 * jsonb with `", "` and `": "` separators, so `scene::text` is longer than compact JSON;
 * this headroom keeps an accepted scene from failing the CHECK (a 500 instead of a message).
 */
export const DIAGRAM_SCENE_INPUT_MAX_BYTES = 1.5 * 1024 * 1024;

/** What the person sees when a scene is over `DIAGRAM_SCENE_INPUT_MAX_BYTES`. */
export const SCENE_TOO_LARGE_MESSAGE =
  "This diagram is too large to save (over 1.5 MB). Remove some shapes or split it into two diagrams.";

export const DIAGRAM_TITLE_MAX = 255;

/** §7.4: a save keeps a snapshot when the last one is older than this (or on "Save version"). */
export const DIAGRAM_SNAPSHOT_INTERVAL_MINUTES = 10;
/** §7.3: at most this many snapshots per diagram; the oldest are pruned. */
export const DIAGRAM_VERSION_CAP = 50;

/** DGM-5 thumbnails: PNG, at most this wide, at most this large, at most once a minute. */
export const THUMBNAIL_MAX_WIDTH = 640;
export const THUMBNAIL_MAX_BYTES = 1024 * 1024;
export const THUMBNAIL_MIN_INTERVAL_MS = 60_000;
export const THUMBNAIL_CONTENT_TYPE = "image/png";

/** DGM-2 typed flow nodes. */
export const FLOW_NODE_TYPES = [
  "service",
  "database",
  "queue",
  "external",
  "actor",
  "decision",
  "note",
] as const;
export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];

export const FLOW_NODE_LABELS: Record<FlowNodeType, string> = {
  service: "Service",
  database: "Database",
  queue: "Queue",
  external: "External",
  actor: "Actor",
  decision: "Decision",
  note: "Note",
};

/** Snap grid of the flow editor (px). */
export const FLOW_GRID = 16;
/** Size a node is laid out with before the browser has measured it. */
export const FLOW_NODE_WIDTH = 176;
export const FLOW_NODE_HEIGHT = 56;
