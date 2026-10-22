import { type Edge, MarkerType, type Viewport } from "@xyflow/react";

import { type FlowScene } from "@/lib/diagrams/scene";

import { type FlowNode } from "./flow-nodes";

/**
 * React Flow state ⇄ the stored flow scene (§7.3 `{ nodes, edges, viewport }`). Only the
 * fields the scene keeps survive: selection, drag state and measured sizes are runtime only.
 */

export function sceneToNodes(scene: FlowScene): FlowNode[] {
  return scene.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: { ...node.position },
    data: node.data.link
      ? { label: node.data.label, link: node.data.link }
      : { label: node.data.label },
  }));
}

export function sceneToEdges(scene: FlowScene): Edge[] {
  return scene.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    ...(edge.label ? { label: edge.label } : {}),
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
}

export function toFlowScene(
  nodes: readonly FlowNode[],
  edges: readonly Edge[],
  viewport: Viewport,
): FlowScene {
  return {
    nodes: nodes.flatMap((node) =>
      node.type
        ? [
            {
              id: node.id,
              type: node.type,
              position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
              data: node.data.link
                ? { label: node.data.label, link: node.data.link }
                : { label: node.data.label },
            },
          ]
        : [],
    ),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
      ...(typeof edge.label === "string" && edge.label ? { label: edge.label } : {}),
    })),
    viewport: {
      x: Math.round(viewport.x),
      y: Math.round(viewport.y),
      zoom: Math.round(viewport.zoom * 1000) / 1000,
    },
  };
}
