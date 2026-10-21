import { Node } from "@tiptap/core";
import { AtSign } from "lucide-react";
import { describe, expect, it } from "vitest";

import { EDITOR_FEATURES, featureExtensions, featureToolbarGroups, featuresFor } from ".";
import { type EditorFeature } from "./types";

const labels = (groups: { label: string }[][]) => groups.map((group) => group.map((b) => b.label));

describe("editor feature registry", () => {
  it("keeps the doc blocks (callout, table, Mermaid) on doc editors only", () => {
    const docBlocks = ["callout", "table", "mermaid"];
    expect(featuresFor("doc").map((feature) => feature.name)).toEqual([
      ...docBlocks,
      "mention",
      "attachments",
      "diagramEmbed",
    ]);
    // @mentions (ISS-7, DOC-9) and attachments (ISS-9, DOC-8) are in every editor.
    expect(featuresFor("issue").map((feature) => feature.name)).toEqual(["mention", "attachments"]);
    expect(featuresFor("comment").map((feature) => feature.name)).toEqual([
      "mention",
      "attachments",
    ]);
    const attachmentExtensions = ["attachmentUpload", "image", "fileAttachment", "attachmentPaste"];
    expect(featureExtensions({ variant: "doc", projectKeys: [] }).map((e) => e.name)).toEqual([
      "callout",
      "tableKit",
      "mermaid",
      "mention",
      ...attachmentExtensions,
      "diagramEmbed",
    ]);
    expect(featureExtensions({ variant: "issue", projectKeys: [] }).map((e) => e.name)).toEqual([
      "mention",
      ...attachmentExtensions,
    ]);
  });

  it("builds the same doc toolbar groups as before the registry", () => {
    expect(labels(featureToolbarGroups("doc"))).toEqual([
      ["Callout", "Insert table", "Mermaid diagram", "Attach file", "Insert diagram"],
      ["Add row below", "Add column right", "Delete row", "Delete table"],
    ]);
    expect(labels(featureToolbarGroups("comment"))).toEqual([["Attach file"]]);
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
    ).toEqual([
      "mention",
      "attachmentUpload",
      "image",
      "fileAttachment",
      "attachmentPaste",
      "sample1",
    ]);
    expect(labels(featureToolbarGroups("comment", features))).toEqual([["Attach file", "Sample"]]);
    expect(labels(featureToolbarGroups("doc", features))[0]).toEqual([
      "Callout",
      "Insert table",
      "Mermaid diagram",
      "Attach file",
      "Insert diagram",
      "Sample",
    ]);
  });
});
