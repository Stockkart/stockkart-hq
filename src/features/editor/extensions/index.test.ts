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
      "attachments",
    ]);
    expect(featuresFor("issue").map((feature) => feature.name)).toEqual(["attachments"]);
    expect(featuresFor("comment").map((feature) => feature.name)).toEqual(["attachments"]);
    const attachmentExtensions = ["attachmentUpload", "image", "fileAttachment", "attachmentPaste"];
    expect(featureExtensions({ variant: "doc", projectKeys: [] }).map((e) => e.name)).toEqual([
      "callout",
      "tableKit",
      "mermaid",
      ...attachmentExtensions,
    ]);
    expect(featureExtensions({ variant: "issue", projectKeys: [] }).map((e) => e.name)).toEqual(
      attachmentExtensions,
    );
  });

  it("builds the same doc toolbar groups as before the registry", () => {
    expect(labels(featureToolbarGroups("doc"))).toEqual([
      ["Callout", "Insert table", "Mermaid diagram", "Attach file"],
      ["Add row below", "Add column right", "Delete row", "Delete table"],
    ]);
    expect(labels(featureToolbarGroups("comment"))).toEqual([["Attach file"]]);
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
    expect(
      featureExtensions({ variant: "comment", projectKeys: ["STK"] }, features).map((e) => e.name),
    ).toContain("mention1");
    expect(labels(featureToolbarGroups("comment", features))).toEqual([["Attach file", "Mention"]]);
    expect(labels(featureToolbarGroups("doc", features))[0]).toEqual([
      "Callout",
      "Insert table",
      "Mermaid diagram",
      "Attach file",
      "Mention",
    ]);
  });
});
