import { Node } from "@tiptap/core";
import { AtSign } from "lucide-react";
import { describe, expect, it } from "vitest";

import { EDITOR_FEATURES, featureExtensions, featureToolbarGroups, featuresFor } from ".";
import { type EditorFeature } from "./types";

const labels = (groups: { label: string }[][]) => groups.map((group) => group.map((b) => b.label));

describe("editor feature registry", () => {
  it("keeps the doc blocks (callout, table, Mermaid) on doc editors only", () => {
    expect(featuresFor("doc").map((feature) => feature.name)).toEqual([
      "callout",
      "table",
      "mermaid",
      "diagramEmbed",
    ]);
    expect(featuresFor("issue")).toEqual([]);
    expect(featuresFor("comment")).toEqual([]);
    expect(featureExtensions({ variant: "doc", projectKeys: [] }).map((e) => e.name)).toEqual([
      "callout",
      "tableKit",
      "mermaid",
      "diagramEmbed",
    ]);
    expect(featureExtensions({ variant: "issue", projectKeys: [] })).toEqual([]);
  });

  it("builds the same doc toolbar groups as before the registry", () => {
    expect(labels(featureToolbarGroups("doc"))).toEqual([
      ["Callout", "Insert table", "Mermaid diagram", "Insert diagram"],
      ["Add row below", "Add column right", "Delete row", "Delete table"],
    ]);
    expect(featureToolbarGroups("comment")).toEqual([]);
  });

  it("adds a new feature from one registry entry", () => {
    const mention: EditorFeature = {
      name: "mention",
      variants: ["issue", "comment", "doc"],
      extensions: ({ projectKeys }) => [
        Node.create({ name: `mention${projectKeys.length}`, inline: true, group: "inline" }),
      ],
      insertButtons: [
        { label: "Mention", icon: AtSign, isActive: () => false, run: () => undefined },
      ],
    };
    const features = [...EDITOR_FEATURES, mention];
    expect(featureExtensions({ variant: "comment", projectKeys: ["STK"] }, features)).toHaveLength(
      1,
    );
    expect(labels(featureToolbarGroups("comment", features))).toEqual([["Mention"]]);
    expect(labels(featureToolbarGroups("doc", features))[0]).toEqual([
      "Callout",
      "Insert table",
      "Mermaid diagram",
      "Insert diagram",
      "Mention",
    ]);
  });
});
