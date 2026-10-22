import { z } from "zod";

import { ISSUE_KEY_INPUT_PATTERN } from "./links";
import {
  type DiagramKind,
  DIAGRAM_SCENE_INPUT_MAX_BYTES,
  FLOW_NODE_TYPES,
  SCENE_TOO_LARGE_MESSAGE,
} from "./constants";

/**
 * The stored scene shapes (SPEC §7.3) and what is derived from them. Isomorphic: the editor
 * builds scenes with these helpers and the server re-validates every save with the schemas.
 *
 * - Whiteboard: Excalidraw elements plus a minimal appState subset (`viewBackgroundColor`,
 *   `gridSize`). Volatile state (selection, zoom, scroll, collaborators, open menus …) and
 *   `files` never reach the database: the schema keeps only the known keys.
 * - Flow: React Flow `{ nodes, edges, viewport }` with typed nodes (DGM-2). Runtime fields
 *   React Flow adds (`selected`, `dragging`, `measured` …) are dropped the same way.
 */

/** UTF-8 bytes of the compact JSON text (what `DIAGRAM_SCENE_INPUT_MAX_BYTES` measures). */
export function sceneByteSize(scene: unknown): number {
  const json = JSON.stringify(scene);
  return json === undefined ? 0 : new TextEncoder().encode(json).length;
}

export function sceneFits(scene: unknown): boolean {
  try {
    return sceneByteSize(scene) <= DIAGRAM_SCENE_INPUT_MAX_BYTES;
  } catch {
    return false; // cyclic or otherwise not JSON
  }
}

// ── Whiteboard (DGM-1) ──────────────────────────────────────────────────────────────────

/**
 * Whiteboard images stay disabled until there is an R2 key layout for diagram files: the
 * storage module only signs attachment and thumbnail keys (`isAppKey`), and attachments
 * belong to issues, comments and docs. So an image element is refused here, and the
 * editor removes any that is pasted or dropped.
 */
export const WHITEBOARD_IMAGES_ENABLED = false;
export const WHITEBOARD_IMAGES_DISABLED_MESSAGE =
  "Images aren't supported in whiteboards yet; attach them to a doc or issue instead.";

/** One Excalidraw element. Its own fields are Excalidraw's business; only these are read. */
const whiteboardElementSchema = z.looseObject({
  id: z.string().min(1).max(100),
  type: z.string().min(1).max(40),
  isDeleted: z.boolean().optional(),
  text: z.string().optional(),
  originalText: z.string().optional(),
  name: z.string().nullable().optional(),
});

export const whiteboardSceneSchema = z.object({
  elements: z
    .array(whiteboardElementSchema)
    .max(20_000, "Too many shapes")
    .refine(
      (elements) => WHITEBOARD_IMAGES_ENABLED || elements.every((e) => e.type !== "image"),
      WHITEBOARD_IMAGES_DISABLED_MESSAGE,
    ),
  appState: z
    .object({
      viewBackgroundColor: z.string().max(40).optional(),
      gridSize: z.number().int().min(0).max(200).nullable().optional(),
    })
    .default({}),
});
export type WhiteboardScene = z.output<typeof whiteboardSceneSchema>;
export type WhiteboardElement = WhiteboardScene["elements"][number];

/** What the editor saves from Excalidraw's `onChange` (elements, appState): no deleted elements. */
export function toWhiteboardScene(
  elements: readonly { readonly id: string; readonly type: string; readonly isDeleted?: boolean }[],
  appState: { viewBackgroundColor?: string; gridSize?: number | null },
): WhiteboardScene {
  return {
    // Excalidraw elements are plain JSON objects; they are re-validated on the server.
    elements: elements
      .filter((element) => !element.isDeleted && element.type !== "image")
      .map((element) => whiteboardElementSchema.parse(element)),
    appState: {
      ...(appState.viewBackgroundColor !== undefined
        ? { viewBackgroundColor: appState.viewBackgroundColor }
        : {}),
      ...(appState.gridSize !== undefined ? { gridSize: appState.gridSize } : {}),
    },
  };
}

/** Every text on the board (text elements and frame names), for search. */
export function whiteboardSceneText(scene: WhiteboardScene): string {
  const parts: string[] = [];
  for (const element of scene.elements) {
    if (element.isDeleted) continue;
    if (element.type === "text") {
      const text = element.originalText ?? element.text ?? "";
      if (text.trim()) parts.push(text.trim());
    } else if (typeof element.name === "string" && element.name.trim()) {
      parts.push(element.name.trim());
    }
  }
  return parts.join("\n");
}

// ── Flow (DGM-2, DGM-7) ─────────────────────────────────────────────────────────────────

const coordinate = z.number().finite().min(-1e7).max(1e7);
const point = z.object({ x: coordinate, y: coordinate });

/** DGM-7: a node opens an issue (by key) or a doc (by id). Paths are built, never stored. */
export const flowNodeLinkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("issue"), key: z.string().regex(ISSUE_KEY_INPUT_PATTERN) }),
  z.object({ kind: z.literal("doc"), id: z.uuid(), title: z.string().max(255) }),
]);
export type FlowNodeLink = z.output<typeof flowNodeLinkSchema>;

export const FLOW_LABEL_MAX = 500;
export const FLOW_EDGE_LABEL_MAX = 200;

const flowNodeSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(FLOW_NODE_TYPES),
  position: point,
  data: z.object({
    label: z.string().max(FLOW_LABEL_MAX),
    link: flowNodeLinkSchema.optional(),
  }),
});

const flowEdgeSchema = z.object({
  id: z.string().min(1).max(200),
  source: z.string().min(1).max(100),
  target: z.string().min(1).max(100),
  sourceHandle: z.string().max(100).nullable().optional(),
  targetHandle: z.string().max(100).nullable().optional(),
  label: z.string().max(FLOW_EDGE_LABEL_MAX).optional(),
});

export const flowSceneSchema = z.object({
  nodes: z.array(flowNodeSchema).max(2000, "Too many nodes"),
  edges: z.array(flowEdgeSchema).max(4000, "Too many edges"),
  viewport: z
    .object({ x: coordinate, y: coordinate, zoom: z.number().finite().min(0.01).max(10) })
    .default({ x: 0, y: 0, zoom: 1 }),
});
export type FlowScene = z.output<typeof flowSceneSchema>;
export type FlowSceneNode = FlowScene["nodes"][number];
export type FlowSceneEdge = FlowScene["edges"][number];

/** Node labels, then edge labels, for search. */
export function flowSceneText(scene: FlowScene): string {
  return [...scene.nodes.map((node) => node.data.label), ...scene.edges.map((e) => e.label ?? "")]
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n");
}

// ── Both kinds ──────────────────────────────────────────────────────────────────────────

export type DiagramScene = WhiteboardScene | FlowScene;

export const isWhiteboardScene = (scene: DiagramScene): scene is WhiteboardScene =>
  "elements" in scene;
export const isFlowScene = (scene: DiagramScene): scene is FlowScene => "nodes" in scene;

export function emptyScene(kind: DiagramKind): DiagramScene {
  return kind === "whiteboard"
    ? { elements: [], appState: {} }
    : { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
}

/** The scene schema of a kind, behind the size limit (checked before anything is walked). */
export function sceneSchemaFor(kind: DiagramKind) {
  const shape = kind === "whiteboard" ? whiteboardSceneSchema : flowSceneSchema;
  return z.unknown().refine(sceneFits, SCENE_TOO_LARGE_MESSAGE).pipe(shape);
}

/** Validates a scene for its kind (size limit included); the first problem as a message. */
export function parseScene(
  kind: DiagramKind,
  scene: unknown,
): { ok: true; scene: DiagramScene } | { ok: false; error: string } {
  const parsed = sceneSchemaFor(kind).safeParse(scene);
  if (parsed.success) return { ok: true, scene: parsed.data };
  return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid diagram" };
}

/** `diagrams.scene_text`: what search indexes besides the title. */
export function sceneText(kind: DiagramKind, scene: DiagramScene): string {
  if (kind === "whiteboard") {
    const parsed = whiteboardSceneSchema.safeParse(scene);
    return parsed.success ? whiteboardSceneText(parsed.data) : "";
  }
  const parsed = flowSceneSchema.safeParse(scene);
  return parsed.success ? flowSceneText(parsed.data) : "";
}
