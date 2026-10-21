import { describe, expect, it } from "vitest";

import { parseScene, sceneText } from "@/lib/diagrams/scene";

import { BUILT_IN_DIAGRAM_TEMPLATES, diagramKindOfTemplate } from "./diagram-templates";

describe("built-in diagram templates (DGM-3, §6.3)", () => {
  it("has the five §6.3 templates, each a valid scene of its kind", () => {
    expect(BUILT_IN_DIAGRAM_TEMPLATES.map((t) => [t.subtype, t.name])).toEqual([
      ["whiteboard:system_context", "Stockkart system context"],
      ["whiteboard:c4_container", "Blank C4 container"],
      ["flow:request", "Request flow"],
      ["flow:outbox", "Event / outbox flow"],
      ["flow:auth", "Auth flow"],
    ]);
    for (const template of BUILT_IN_DIAGRAM_TEMPLATES) {
      const kind = diagramKindOfTemplate(template.subtype);
      expect(kind).not.toBeNull();
      if (!kind) continue;
      expect(parseScene(kind, template.content)).toMatchObject({ ok: true });
      expect(sceneText(kind, template.content)).not.toBe("");
    }
  });

  it("draws the system context the SPEC describes", () => {
    const text = sceneText(
      "whiteboard",
      BUILT_IN_DIAGRAM_TEMPLATES[0]?.content ?? { elements: [], appState: {} },
    );
    for (const part of [
      "inventory-platform\n(Vercel)",
      "inventory-api\n(DigitalOcean)",
      "MongoDB Atlas",
      "OCR provider",
      "Email\n(outbox)",
      "Stockkart HQ\n(Vercel)",
      "Neon\n(Postgres)",
      "HTTPS",
    ]) {
      expect(text).toContain(part);
    }
  });

  it("holds generic architecture only: no URLs, hosts or secrets", () => {
    const json = JSON.stringify(BUILT_IN_DIAGRAM_TEMPLATES);
    expect(json).not.toMatch(/https?:\/\/|:\/\/|\.com\b|\.io\b|password=|secret|token=/i);
  });

  it("reads the diagram kind back from the subtype", () => {
    expect(diagramKindOfTemplate("flow:auth")).toBe("flow");
    expect(diagramKindOfTemplate("whiteboard:x")).toBe("whiteboard");
    expect(diagramKindOfTemplate("adr")).toBeNull();
  });
});
