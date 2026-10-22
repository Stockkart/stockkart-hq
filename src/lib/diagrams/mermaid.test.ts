import { describe, expect, it } from "vitest";

import { FLOW_NODE_TYPES } from "./constants";
import { escapeMermaidLabel, flowToMermaid } from "./mermaid";
import { type FlowScene } from "./scene";

const viewport = { x: 0, y: 0, zoom: 1 };

describe("flowToMermaid (DGM-6)", () => {
  it("gives every node type its own shape, with ids replaced by n1, n2 …", () => {
    const scene: FlowScene = {
      nodes: FLOW_NODE_TYPES.map((type, i) => ({
        id: `weird id ${i} -->`,
        type,
        position: { x: i * 10, y: 0 },
        data: { label: type },
      })),
      edges: [],
      viewport,
    };
    expect(flowToMermaid(scene)).toBe(
      [
        "flowchart LR",
        '  n1["service"]',
        '  n2[("database")]',
        '  n3[["queue"]]',
        '  n4{{"external"}}',
        '  n5(["actor"])',
        '  n6{"decision"}',
        '  n7>"note"]',
        "",
      ].join("\n"),
    );
  });

  it("writes plain and labelled edges, and skips edges to missing nodes", () => {
    const scene: FlowScene = {
      nodes: [
        { id: "client", type: "actor", position: { x: 0, y: 0 }, data: { label: "Client" } },
        { id: "api", type: "service", position: { x: 1, y: 0 }, data: { label: "API" } },
      ],
      edges: [
        { id: "1", source: "client", target: "api", label: "HTTPS" },
        { id: "2", source: "api", target: "client" },
        { id: "3", source: "api", target: "ghost", label: "lost" },
      ],
      viewport,
    };
    expect(flowToMermaid(scene, "TB")).toBe(
      [
        "flowchart TB",
        '  n1(["Client"])',
        '  n2["API"]',
        '  n1 -->|"HTTPS"| n2',
        "  n2 --> n1",
        "",
      ].join("\n"),
    );
  });

  it("escapes characters that would end a label or inject syntax", () => {
    expect(escapeMermaidLabel('say "hi" | a<b>c #1 `x`\nnext')).toBe(
      "say #quot;hi#quot; #124; a#lt;b#gt;c #35;1 #96;x#96; next",
    );
    const scene: FlowScene = {
      nodes: [
        {
          id: "a",
          type: "service",
          position: { x: 0, y: 0 },
          data: { label: '"] --> evil["' },
        },
        { id: "b", type: "service", position: { x: 1, y: 0 }, data: { label: "" } },
      ],
      edges: [{ id: "e", source: "a", target: "b", label: 'x"| --> n9' }],
      viewport,
    };
    const lines = flowToMermaid(scene).split("\n");
    expect(lines[1]).toBe('  n1["#quot;] --#gt; evil[#quot;"]');
    // An empty label stays a valid node.
    expect(lines[2]).toBe('  n2[" "]');
    expect(lines[3]).toBe('  n1 -->|"x#quot;#124; --#gt; n9"| n2');
  });
});
