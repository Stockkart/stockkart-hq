import { describe, expect, it } from "vitest";

import { DIAGRAM_SCENE_INPUT_MAX_BYTES, SCENE_TOO_LARGE_MESSAGE } from "./constants";
import {
  emptyScene,
  type FlowScene,
  parseScene,
  sceneByteSize,
  sceneFits,
  sceneText,
  toWhiteboardScene,
  WHITEBOARD_IMAGES_DISABLED_MESSAGE,
} from "./scene";

const flow: FlowScene = {
  nodes: [
    { id: "a", type: "service", position: { x: 0, y: 0 }, data: { label: "inventory-api" } },
    { id: "b", type: "database", position: { x: 200, y: 0 }, data: { label: " MongoDB " } },
    { id: "c", type: "note", position: { x: 0, y: 100 }, data: { label: "" } },
  ],
  edges: [
    { id: "e1", source: "a", target: "b", label: "queries" },
    { id: "e2", source: "b", target: "c" },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

describe("scene_text (search)", () => {
  it("collects whiteboard text elements and frame names, skipping deleted ones", () => {
    const scene = {
      elements: [
        { id: "1", type: "rectangle" },
        { id: "2", type: "text", text: "wrapped\ntext", originalText: "inventory-api" },
        { id: "3", type: "text", text: "gone", isDeleted: true },
        { id: "4", type: "frame", name: "Container" },
        { id: "5", type: "text", text: "  " },
      ],
      appState: {},
    };
    expect(sceneText("whiteboard", scene)).toBe("inventory-api\nContainer");
  });

  it("collects flow node labels, then edge labels", () => {
    expect(sceneText("flow", flow)).toBe("inventory-api\nMongoDB\nqueries");
  });

  it("is empty for an empty scene of either kind", () => {
    expect(sceneText("whiteboard", emptyScene("whiteboard"))).toBe("");
    expect(sceneText("flow", emptyScene("flow"))).toBe("");
  });
});

describe("scene validation", () => {
  it("keeps only the stored whiteboard fields (no files, no volatile app state)", () => {
    const parsed = parseScene("whiteboard", {
      type: "excalidraw",
      elements: [{ id: "1", type: "rectangle", x: 1, customField: true }],
      appState: {
        viewBackgroundColor: "#fff",
        gridSize: 20,
        zoom: { value: 2 },
        selectedElementIds: {},
      },
      files: { abc: { dataURL: "data:image/png;base64,AAAA" } },
    });
    expect(parsed).toEqual({
      ok: true,
      scene: {
        // Excalidraw's own element fields are kept as they are.
        elements: [{ id: "1", type: "rectangle", x: 1, customField: true }],
        appState: { viewBackgroundColor: "#fff", gridSize: 20 },
      },
    });
  });

  it("refuses image elements while whiteboard images are disabled", () => {
    expect(
      parseScene("whiteboard", {
        elements: [{ id: "i", type: "image", fileId: "f" }],
        appState: {},
      }),
    ).toEqual({ ok: false, error: WHITEBOARD_IMAGES_DISABLED_MESSAGE });
  });

  it("drops React Flow runtime fields and refuses unknown node types", () => {
    const parsed = parseScene("flow", {
      ...flow,
      nodes: flow.nodes.map((node) => ({ ...node, selected: true, measured: { width: 1 } })),
    });
    expect(parsed).toEqual({ ok: true, scene: flow });
    expect(
      parseScene("flow", {
        ...flow,
        nodes: [{ id: "x", type: "rocket", position: { x: 0, y: 0 }, data: { label: "" } }],
      }).ok,
    ).toBe(false);
  });

  it("refuses a scene of the other kind", () => {
    expect(parseScene("flow", emptyScene("whiteboard")).ok).toBe(false);
  });
});

describe("the 2 MB scene limit (input checked at 1.5 MB of compact JSON)", () => {
  const sized = (bytes: number) => {
    const base = { elements: [{ id: "t", type: "text", text: "" }], appState: {} };
    const overhead = sceneByteSize(base);
    return {
      elements: [{ id: "t", type: "text", text: "x".repeat(bytes - overhead) }],
      appState: {},
    };
  };

  it("measures UTF-8 bytes, not characters", () => {
    expect(sceneByteSize({ t: "é" })).toBe(JSON.stringify({ t: "x" }).length + 1);
  });

  it("accepts a scene at the limit and refuses one byte more, with a clear message", () => {
    const atLimit = sized(DIAGRAM_SCENE_INPUT_MAX_BYTES);
    expect(sceneByteSize(atLimit)).toBe(DIAGRAM_SCENE_INPUT_MAX_BYTES);
    expect(sceneFits(atLimit)).toBe(true);
    expect(parseScene("whiteboard", atLimit).ok).toBe(true);

    const over = sized(DIAGRAM_SCENE_INPUT_MAX_BYTES + 1);
    expect(sceneFits(over)).toBe(false);
    expect(parseScene("whiteboard", over)).toEqual({ ok: false, error: SCENE_TOO_LARGE_MESSAGE });
  });

  it("refuses a cyclic value instead of throwing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(sceneFits(cyclic)).toBe(false);
  });
});

describe("toWhiteboardScene (what the editor saves)", () => {
  it("drops deleted and image elements and keeps only the appState subset", () => {
    const scene = toWhiteboardScene(
      [
        { id: "1", type: "rectangle" },
        { id: "2", type: "rectangle", isDeleted: true },
        { id: "3", type: "image" },
      ],
      { viewBackgroundColor: "#123456", gridSize: null },
    );
    expect(scene).toEqual({
      elements: [{ id: "1", type: "rectangle" }],
      appState: { viewBackgroundColor: "#123456", gridSize: null },
    });
  });
});
