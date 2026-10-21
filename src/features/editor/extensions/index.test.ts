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
      "mention",
    ]);
    // @mentions (ISS-7, DOC-9) are in every editor.
    expect(featuresFor("issue").map((feature) => feature.name)).toEqual(["mention"]);
    expect(featuresFor("comment").map((feature) => feature.name)).toEqual(["mention"]);
    expect(featureExtensions({ variant: "doc", projectKeys: [] }).map((e) => e.name)).toEqual([
      "callout",
      "tableKit",
      "mermaid",
      "mention",
    ]);
    expect(featureExtensions({ variant: "issue", projectKeys: [] }).map((e) => e.name)).toEqual([
      "mention",
    ]);
  });

  it("builds the same doc toolbar groups as before the registry", () => {
    expect(labels(featureToolbarGroups("doc"))).toEqual([
      ["Callout", "Insert table", "Mermaid diagram"],
      ["Add row below", "Add column right", "Delete row", "Delete table"],
    ]);
    expect(featureToolbarGroups("comment")).toEqual([]);
  });

  it("adds a new feature from one registry entry", () => {
    const sample: EditorFeature = {
      name: "sample",
      variants: ["issue", "comment", "doc"],
      extensions: ({ projectKeys }) => [
        Node.create({ name: `sample${projectKeys.length}`, inline: true, group: "inline" }),
      ],
      insertButtons: [
        { label: "Sample", icon: AtSign, isActive: () => false, run: () => undefined },
      ],
    };
    const features = [...EDITOR_FEATURES, sample];
    expect(
      featureExtensions({ variant: "comment", projectKeys: ["STK"] }, features).map((e) => e.name),
    ).toEqual(["mention", "sample1"]);
    expect(labels(featureToolbarGroups("comment", features))).toEqual([["Sample"]]);
    expect(labels(featureToolbarGroups("doc", features))[0]).toEqual([
      "Callout",
      "Insert table",
      "Mermaid diagram",
      "Sample",
    ]);
  });
});
