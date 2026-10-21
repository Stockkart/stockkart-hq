import dagre from "@dagrejs/dagre";

import { FLOW_GRID, FLOW_NODE_HEIGHT, FLOW_NODE_WIDTH } from "./constants";

/**
 * DGM-2 "Tidy": a layered layout of a flow with dagre (MIT). Pure: takes node sizes and
 * edges, returns a top-left position per node id, snapped to the editor's grid.
 */
export interface LayoutNode {
  id: string;
  width?: number;
  height?: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

const snap = (value: number) => Math.round(value / FLOW_GRID) * FLOW_GRID;

export function tidyLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  direction: "LR" | "TB" = "LR",
): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: direction, nodesep: 48, ranksep: 96, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    graph.setNode(node.id, {
      width: node.width ?? FLOW_NODE_WIDTH,
      height: node.height ?? FLOW_NODE_HEIGHT,
    });
  }
  for (const edge of edges) {
    if (ids.has(edge.source) && ids.has(edge.target)) graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const laid = graph.node(node.id);
    const width = node.width ?? FLOW_NODE_WIDTH;
    const height = node.height ?? FLOW_NODE_HEIGHT;
    // dagre gives centres; React Flow positions are top-left corners.
    positions.set(node.id, { x: snap(laid.x - width / 2), y: snap(laid.y - height / 2) });
  }
  return positions;
}
