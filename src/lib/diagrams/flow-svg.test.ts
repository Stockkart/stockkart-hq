import { describe, expect, it } from "vitest";

import { FLOW_NODE_TYPES } from "./constants";
import { escapeXml, flowToSvg } from "./flow-svg";
import { tidyLayout } from "./layout";
import { type FlowScene } from "./scene";

describe("flowToSvg (DGM-5/6 thumbnails and exports)", () => {
  it("draws every node type and labelled edges in one standalone SVG", () => {
    const scene: FlowScene = {
      nodes: FLOW_NODE_TYPES.map((type, i) => ({
        id: type,
        type,
        position: { x: i * 200, y: 0 },
        data: { label: `${type} node` },
      })),
      edges: [{ id: "e", source: "service", target: "database", label: "SQL" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const svg = flowToSvg(scene);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    for (const type of FLOW_NODE_TYPES) expect(svg).toContain(`>${type} node<`);
    expect(svg).toContain(">SQL<");
    expect(svg.match(/<line [^>]*marker-end/g)).toHaveLength(1);
  });

  it("escapes labels, so a label cannot add markup", () => {
    expect(escapeXml(`<script>&"'`)).toBe("&lt;script&gt;&amp;&quot;&#39;");
    const svg = flowToSvg({
      nodes: [
        {
          id: "x",
          type: "note",
          position: { x: 0, y: 0 },
          data: { label: "</text><script>alert(1)</script>" },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    expect(svg).not.toContain("<script");
    expect(svg).toContain("&lt;/text&gt;&lt;script&gt;");
  });

  it("renders an empty flow as a small blank image", () => {
    expect(flowToSvg({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })).toContain(
      'width="64" height="64"',
    );
  });
});

describe("tidyLayout (DGM-2 auto-layout)", () => {
  it("lays a chain out left to right on the grid", () => {
    const positions = tidyLayout(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "c", target: "missing" },
      ],
    );
    const [a, b, c] = ["a", "b", "c"].map((id) => positions.get(id));
    expect(a && b && c).toBeTruthy();
    if (!a || !b || !c) return;
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    for (const point of [a, b, c]) {
      expect(point.x % 16).toBe(0);
      expect(point.y % 16).toBe(0);
    }
  });
});
