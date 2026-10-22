import {
  FLOW_NODE_HEIGHT,
  FLOW_NODE_LABELS,
  FLOW_NODE_WIDTH,
  type FlowNodeType,
} from "./constants";
import { type FlowScene } from "./scene";

/**
 * DGM-2 node look, shared by the React Flow nodes and the SVG export (one palette, readable
 * on light and dark canvases), and a pure flow → SVG renderer for the PNG/SVG exports and
 * the thumbnail (DGM-5/6). Pure and isomorphic: it works from the scene alone, so a
 * thumbnail can still be drawn while the editor unmounts.
 */

export const FLOW_NODE_STYLE: Record<FlowNodeType, { fill: string; stroke: string }> = {
  service: { fill: "#dbeafe", stroke: "#2563eb" },
  database: { fill: "#fef3c7", stroke: "#d97706" },
  queue: { fill: "#ede9fe", stroke: "#7c3aed" },
  external: { fill: "#e5e7eb", stroke: "#4b5563" },
  actor: { fill: "#dcfce7", stroke: "#16a34a" },
  decision: { fill: "#fee2e2", stroke: "#dc2626" },
  note: { fill: "#fef9c3", stroke: "#a16207" },
};

const TEXT = "#111827";
const EDGE = "#6b7280";
const PADDING = 32;
const MAX_LINE_CHARS = 24;

/** Text for an SVG text node or attribute (`&`, `<`, `>`, quotes). */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

/** Up to two lines of about `MAX_LINE_CHARS`, the second ending in "…" if cut. */
function wrap(label: string): string[] {
  const words = label.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= MAX_LINE_CHARS || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= 2) return lines;
  const second = lines.slice(1).join(" ");
  return [lines[0] ?? "", `${second.slice(0, MAX_LINE_CHARS - 1)}…`];
}

function shape(type: FlowNodeType, x: number, y: number, w: number, h: number): string {
  const { fill, stroke } = FLOW_NODE_STYLE[type];
  const paint = `fill="${fill}" stroke="${stroke}" stroke-width="2"`;
  switch (type) {
    case "decision": {
      const points = [
        [x + w / 2, y],
        [x + w, y + h / 2],
        [x + w / 2, y + h],
        [x, y + h / 2],
      ];
      return `<polygon points="${points.map((p) => p.join(",")).join(" ")}" ${paint}/>`;
    }
    case "actor":
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" ${paint}/>`;
    case "database":
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" ${paint}/><ellipse cx="${x + w / 2}" cy="${y + 6}" rx="${w / 2}" ry="6" ${paint}/>`;
    case "queue":
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" ${paint}/><line x1="${x + 10}" y1="${y}" x2="${x + 10}" y2="${y + h}" stroke="${stroke}" stroke-width="2"/><line x1="${x + w - 10}" y1="${y}" x2="${x + w - 10}" y2="${y + h}" stroke="${stroke}" stroke-width="2"/>`;
    case "external":
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" stroke-dasharray="6 4" ${paint}/>`;
    case "note":
      return `<path d="M${x} ${y}H${x + w - 14}L${x + w} ${y + 14}V${y + h}H${x}Z" ${paint}/>`;
    case "service":
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" ${paint}/>`;
  }
}

/** Where the line from a box's centre towards `towards` leaves the box. */
function boxEdge(
  box: { x: number; y: number; w: number; h: number },
  towards: { x: number; y: number },
) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    dx === 0 ? Infinity : box.w / 2 / Math.abs(dx),
    dy === 0 ? Infinity : box.h / 2 / Math.abs(dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * The flow as a standalone SVG document. `background` fills the canvas (exports and
 * thumbnails are always light so they read the same in either theme).
 */
export function flowToSvg(scene: FlowScene, { background = "#ffffff" } = {}): string {
  const w = FLOW_NODE_WIDTH;
  const h = FLOW_NODE_HEIGHT;
  const boxes = new Map(
    scene.nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y, w, h }]),
  );
  const xs = scene.nodes.map((node) => node.position.x);
  const ys = scene.nodes.map((node) => node.position.y);
  const minX = (xs.length ? Math.min(...xs) : 0) - PADDING;
  const minY = (ys.length ? Math.min(...ys) : 0) - PADDING;
  const width = (xs.length ? Math.max(...xs) + w : 0) + PADDING - minX;
  const height = (ys.length ? Math.max(...ys) + h : 0) + PADDING - minY;

  const edges = scene.edges.flatMap((edge) => {
    const from = boxes.get(edge.source);
    const to = boxes.get(edge.target);
    if (!from || !to) return [];
    const start = boxEdge(from, { x: to.x + to.w / 2, y: to.y + to.h / 2 });
    const end = boxEdge(to, { x: from.x + from.w / 2, y: from.y + from.h / 2 });
    const line = `<line x1="${round(start.x)}" y1="${round(start.y)}" x2="${round(end.x)}" y2="${round(end.y)}" stroke="${EDGE}" stroke-width="1.5" marker-end="url(#arrow)"/>`;
    if (!edge.label) return [line];
    const mx = round((start.x + end.x) / 2);
    const my = round((start.y + end.y) / 2);
    return [
      line,
      `<text x="${mx}" y="${my - 6}" text-anchor="middle" font-size="11" fill="${EDGE}" paint-order="stroke" stroke="${background}" stroke-width="4">${escapeXml(edge.label)}</text>`,
    ];
  });

  const nodes = scene.nodes.map((node) => {
    const { x, y } = node.position;
    const lines = wrap(node.data.label || FLOW_NODE_LABELS[node.type]);
    const firstY = y + h / 2 - ((lines.length - 1) * 15) / 2 + 4;
    const text = lines
      .map(
        (line, i) =>
          `<text x="${x + w / 2}" y="${round(firstY + i * 15)}" text-anchor="middle" font-size="13" fill="${TEXT}">${escapeXml(line)}</text>`,
      )
      .join("");
    return `<g>${shape(node.type, x, y, w, h)}${text}</g>`;
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="${round(minX)} ${round(minY)} ${round(width)} ${round(height)}" font-family="ui-sans-serif, system-ui, sans-serif">`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${EDGE}"/></marker></defs>`,
    `<rect x="${round(minX)}" y="${round(minY)}" width="${round(width)}" height="${round(height)}" fill="${background}"/>`,
    ...edges,
    ...nodes,
    "</svg>",
  ].join("");
}
