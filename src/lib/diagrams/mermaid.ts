import { type FlowNodeType } from "./constants";
import { type FlowScene } from "./scene";

/**
 * DGM-6 "Copy as Mermaid": a flow as Mermaid `flowchart` text. Pure and isomorphic.
 *
 * Node ids are replaced by `n1`, `n2` … (React Flow ids may hold any characters), and every
 * label is quoted with Mermaid's entity codes for the characters that would end or change
 * it, so no label can inject Mermaid syntax.
 */

/** Opening and closing bracket of each node type's Mermaid shape. */
const SHAPES: Record<FlowNodeType, [string, string]> = {
  service: ["[", "]"], // rectangle
  database: ["[(", ")]"], // cylinder
  queue: ["[[", "]]"], // subroutine
  external: ["{{", "}}"], // hexagon
  actor: ["([", "])"], // stadium
  decision: ["{", "}"], // rhombus
  note: [">", "]"], // asymmetric (flag)
};

/**
 * A label as the inside of a Mermaid `"…"` string. `#` goes first (it starts the entity
 * codes); line breaks become spaces.
 */
export function escapeMermaidLabel(label: string): string {
  return label
    .replace(/[\r\n\t]+/g, " ")
    .replace(/#/g, "#35;")
    .replace(/"/g, "#quot;")
    .replace(/\|/g, "#124;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/`/g, "#96;")
    .trim();
}

export function flowToMermaid(scene: FlowScene, direction: "LR" | "TB" = "LR"): string {
  const ids = new Map<string, string>();
  scene.nodes.forEach((node, index) => ids.set(node.id, `n${index + 1}`));
  const lines = [`flowchart ${direction}`];
  for (const node of scene.nodes) {
    const [open, close] = SHAPES[node.type];
    const label = escapeMermaidLabel(node.data.label) || " ";
    lines.push(`  ${ids.get(node.id)}${open}"${label}"${close}`);
  }
  for (const edge of scene.edges) {
    const source = ids.get(edge.source);
    const target = ids.get(edge.target);
    // An edge to a node that is not in the scene is skipped rather than invented.
    if (!source || !target) continue;
    const label = edge.label ? escapeMermaidLabel(edge.label) : "";
    lines.push(label ? `  ${source} -->|"${label}"| ${target}` : `  ${source} --> ${target}`);
  }
  return `${lines.join("\n")}\n`;
}
