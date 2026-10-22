import { type DiagramKind, type FlowNodeType } from "@/lib/diagrams/constants";
import {
  type FlowScene,
  type FlowSceneEdge,
  type FlowSceneNode,
  type WhiteboardElement,
  type WhiteboardScene,
} from "@/lib/diagrams/scene";

/**
 * DGM-3 / SPEC §6.3 built-in diagram templates (`templates.kind = 'diagram'`). Generic
 * architecture only: no hosts, URLs or secrets.
 *
 * `templates` has one built-in row per (kind, subtype), so `subtype` is `<diagram kind>:<slug>`
 * (several templates share a diagram kind); `diagramKindOfTemplate` reads the kind back.
 * `content` is the scene, in the same shape as `diagrams.scene` (§7.3).
 */

export interface BuiltInDiagramTemplate {
  subtype: `${DiagramKind}:${string}`;
  name: string;
  description: string;
  content: WhiteboardScene | FlowScene;
}

export function diagramKindOfTemplate(subtype: string): DiagramKind | null {
  const kind = subtype.split(":")[0];
  return kind === "whiteboard" || kind === "flow" ? kind : null;
}

// ── Whiteboard helpers: minimal Excalidraw elements; the editor's `restoreElements` fills
//    in the rest (versions, seeds, text metrics) when the scene is opened. ─────────────────

const STROKE = "#1e1e1e";
const FONT_FAMILY = 5; // Excalifont, Excalidraw's default hand-drawn font
const FONT_SIZE = 20;
const LINE_HEIGHT = 1.25;

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function textElement(
  id: string,
  text: string,
  at: { x: number; y: number; width: number },
  containerId: string | null,
  fontSize = FONT_SIZE,
): WhiteboardElement {
  const lines = text.split("\n").length;
  return {
    id,
    type: "text",
    x: at.x,
    y: at.y,
    width: at.width,
    height: lines * fontSize * LINE_HEIGHT,
    text,
    originalText: text,
    fontSize,
    fontFamily: FONT_FAMILY,
    textAlign: "center",
    verticalAlign: "middle",
    containerId,
    lineHeight: LINE_HEIGHT,
    autoResize: true,
    strokeColor: STROKE,
    backgroundColor: "transparent",
  };
}

function box(
  id: string,
  at: { x: number; y: number },
  label: string,
  backgroundColor: string,
  arrowIds: string[],
  shape: "rectangle" | "ellipse" = "rectangle",
): { box: Box; elements: WhiteboardElement[] } {
  const width = 220;
  const height = 90;
  const textId = `${id}-label`;
  const rect: WhiteboardElement = {
    id,
    type: shape,
    x: at.x,
    y: at.y,
    width,
    height,
    strokeColor: STROKE,
    backgroundColor,
    fillStyle: "solid",
    roundness: shape === "rectangle" ? { type: 3 } : { type: 2 },
    boundElements: [
      { type: "text", id: textId },
      ...arrowIds.map((arrowId) => ({ type: "arrow", id: arrowId })),
    ],
  };
  const lines = label.split("\n").length;
  const textHeight = lines * FONT_SIZE * LINE_HEIGHT;
  return {
    box: { id, x: at.x, y: at.y, width, height },
    elements: [
      rect,
      textElement(
        textId,
        label,
        { x: at.x + 10, y: at.y + (height - textHeight) / 2, width: width - 20 },
        id,
      ),
    ],
  };
}

/** An arrow from one box's side to another's (right → left, or bottom → top). */
function arrow(id: string, from: Box, to: Box, label?: string): WhiteboardElement[] {
  const horizontal = to.x >= from.x + from.width;
  const start = horizontal
    ? { x: from.x + from.width, y: from.y + from.height / 2 }
    : { x: from.x + from.width / 2, y: from.y + from.height };
  const end = horizontal
    ? { x: to.x, y: to.y + to.height / 2 }
    : { x: to.x + to.width / 2, y: to.y };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const labelId = `${id}-label`;
  const element: WhiteboardElement = {
    id,
    type: "arrow",
    x: start.x,
    y: start.y,
    width: Math.abs(dx),
    height: Math.abs(dy),
    points: [
      [0, 0],
      [dx, dy],
    ],
    strokeColor: STROKE,
    backgroundColor: "transparent",
    startBinding: { elementId: from.id, focus: 0, gap: 4 },
    endBinding: { elementId: to.id, focus: 0, gap: 4 },
    startArrowhead: null,
    endArrowhead: "arrow",
    roundness: { type: 2 },
    boundElements: label ? [{ type: "text", id: labelId }] : [],
  };
  if (!label) return [element];
  return [
    element,
    textElement(
      labelId,
      label,
      { x: start.x + dx / 2 - 50, y: start.y + dy / 2 - 12, width: 100 },
      id,
      16,
    ),
  ];
}

function frame(id: string, name: string, at: { x: number; y: number }): WhiteboardElement {
  return {
    id,
    type: "frame",
    name,
    x: at.x,
    y: at.y,
    width: 320,
    height: 240,
    strokeColor: "#bbb",
    backgroundColor: "transparent",
  };
}

const COLORS = {
  app: "#a5d8ff",
  api: "#b2f2bb",
  store: "#ffec99",
  external: "#e9ecef",
  hq: "#d0bfff",
};

function systemContext(): WhiteboardScene {
  const platform = box("platform", { x: 0, y: 140 }, "inventory-platform\n(Vercel)", COLORS.app, [
    "a-platform-api",
  ]);
  const api = box("api", { x: 400, y: 140 }, "inventory-api\n(DigitalOcean)", COLORS.api, [
    "a-platform-api",
    "a-api-mongo",
    "a-api-ocr",
    "a-api-email",
    "a-hq-api",
  ]);
  const mongo = box("mongo", { x: 800, y: 0 }, "MongoDB Atlas", COLORS.store, ["a-api-mongo"]);
  const ocr = box("ocr", { x: 800, y: 140 }, "OCR provider", COLORS.external, ["a-api-ocr"]);
  const email = box("email", { x: 800, y: 280 }, "Email\n(outbox)", COLORS.external, [
    "a-api-email",
  ]);
  const hq = box("hq", { x: 400, y: 420 }, "Stockkart HQ\n(Vercel)", COLORS.hq, [
    "a-hq-api",
    "a-hq-neon",
  ]);
  const neon = box("neon", { x: 800, y: 420 }, "Neon\n(Postgres)", COLORS.store, ["a-hq-neon"]);
  // HQ sits below the API; its arrow goes up to the API's bottom edge.
  const hqToApi: WhiteboardElement[] = (() => {
    const from = hq.box;
    const to = api.box;
    const start = { x: from.x + from.width / 2, y: from.y };
    const end = { x: to.x + to.width / 2, y: to.y + to.height };
    return [
      {
        id: "a-hq-api",
        type: "arrow",
        x: start.x,
        y: start.y,
        width: 0,
        height: Math.abs(end.y - start.y),
        points: [
          [0, 0],
          [0, end.y - start.y],
        ],
        strokeColor: STROKE,
        backgroundColor: "transparent",
        startBinding: { elementId: from.id, focus: 0, gap: 4 },
        endBinding: { elementId: to.id, focus: 0, gap: 4 },
        startArrowhead: null,
        endArrowhead: "arrow",
        boundElements: [{ type: "text", id: "a-hq-api-label" }],
      },
      textElement(
        "a-hq-api-label",
        "auth (/auth/me)",
        { x: start.x - 70, y: (start.y + end.y) / 2 - 12, width: 140 },
        "a-hq-api",
        16,
      ),
    ];
  })();
  return {
    elements: [
      ...platform.elements,
      ...api.elements,
      ...mongo.elements,
      ...ocr.elements,
      ...email.elements,
      ...hq.elements,
      ...neon.elements,
      ...arrow("a-platform-api", platform.box, api.box, "HTTPS"),
      ...arrow("a-api-mongo", api.box, mongo.box),
      ...arrow("a-api-ocr", api.box, ocr.box),
      ...arrow("a-api-email", api.box, email.box),
      ...hqToApi,
      ...arrow("a-hq-neon", hq.box, neon.box, "SQL"),
      textElement("title", "Stockkart system context", { x: 0, y: 0, width: 360 }, null, 28),
    ],
    appState: { viewBackgroundColor: "#ffffff" },
  };
}

function blankC4(): WhiteboardScene {
  return {
    elements: [
      frame("person", "Person", { x: 0, y: 0 }),
      frame("container", "Container", { x: 380, y: 0 }),
      frame("database", "Database", { x: 0, y: 300 }),
      frame("external", "External system", { x: 380, y: 300 }),
    ],
    appState: { viewBackgroundColor: "#ffffff" },
  };
}

// ── Flow helpers ───────────────────────────────────────────────────────────────────────

const node = (id: string, type: FlowNodeType, label: string, x: number, y: number) =>
  ({ id, type, position: { x, y }, data: { label } }) satisfies FlowSceneNode;
const edge = (source: string, target: string, label?: string): FlowSceneEdge => ({
  id: `e-${source}-${target}`,
  source,
  target,
  ...(label ? { label } : {}),
});
const flow = (nodes: FlowSceneNode[], edges: FlowSceneEdge[]): FlowScene => ({
  nodes,
  edges,
  viewport: { x: 32, y: 32, zoom: 1 },
});

function requestFlow(): FlowScene {
  return flow(
    [
      node("client", "actor", "Client", 0, 112),
      node("api", "service", "API", 240, 112),
      node("auth", "decision", "Valid bearer token?", 480, 112),
      node("service", "service", "Service", 720, 112),
      node("db", "database", "DB", 960, 112),
      node("denied", "note", "401 Unauthorized", 480, 288),
    ],
    [
      edge("client", "api", "HTTPS request"),
      edge("api", "auth", "auth step"),
      edge("auth", "service", "yes"),
      edge("auth", "denied", "no"),
      edge("service", "db", "query"),
    ],
  );
}

function outboxFlow(): FlowScene {
  return flow(
    [
      node("write", "service", "Write (request handler)", 0, 112),
      node("outbox", "database", "Outbox table", 240, 112),
      node("dispatcher", "queue", "Scheduled dispatcher", 480, 112),
      node("provider", "external", "Provider (email, OCR …)", 720, 112),
      node("failed", "decision", "Delivery failed?", 480, 288),
      node("retry", "note", "Retry with backoff; give up after N attempts", 720, 288),
    ],
    [
      edge("write", "outbox", "same transaction"),
      edge("outbox", "dispatcher", "poll pending rows"),
      edge("dispatcher", "provider", "send"),
      edge("dispatcher", "failed"),
      edge("failed", "outbox", "yes: reschedule"),
      edge("failed", "retry"),
    ],
  );
}

function authFlow(): FlowScene {
  return flow(
    [
      node("user", "actor", "User", 0, 112),
      node("login", "service", "Login", 240, 112),
      node("issue", "service", "Token issue", 480, 112),
      node("request", "service", "API request", 720, 112),
      node("check", "decision", "Bearer check", 960, 112),
      node("ok", "service", "Protected handler", 1200, 112),
      node("denied", "note", "401: sign in again", 960, 288),
      node("adr", "note", "See ADR-0007 and ADR-0010", 240, 288),
    ],
    [
      edge("user", "login", "email + password"),
      edge("login", "issue", "credentials valid"),
      edge("issue", "request", "access token"),
      edge("request", "check", "Authorization: Bearer"),
      edge("check", "ok", "valid"),
      edge("check", "denied", "expired / invalid"),
    ],
  );
}

export const BUILT_IN_DIAGRAM_TEMPLATES: BuiltInDiagramTemplate[] = [
  {
    subtype: "whiteboard:system_context",
    name: "Stockkart system context",
    description:
      "inventory-platform → inventory-api → MongoDB Atlas, OCR, email outbox; HQ and Neon.",
    content: systemContext(),
  },
  {
    subtype: "whiteboard:c4_container",
    name: "Blank C4 container",
    description: "Labelled frames for Person, Container, Database and External system.",
    content: blankC4(),
  },
  {
    subtype: "flow:request",
    name: "Request flow",
    description: "Client → API → Service → DB, with an auth step.",
    content: requestFlow(),
  },
  {
    subtype: "flow:outbox",
    name: "Event / outbox flow",
    description: "Write → outbox table → scheduled dispatcher → provider, with retry.",
    content: outboxFlow(),
  },
  {
    subtype: "flow:auth",
    name: "Auth flow",
    description: "Login → token issue → bearer check (ADR-0007, ADR-0010).",
    content: authFlow(),
  },
];
