import { Extension } from "@tiptap/core";
import { type Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { splitIssueRefs } from "@/lib/issues/keys";

/**
 * Styles `STK-123` as a chip while editing (ISS-7, DOC-9). Decorations only: the stored JSON
 * stays plain text, and the read-only renderer turns the same matches into links.
 */

const key = new PluginKey<DecorationSet>("issueRefHighlight");

function decorate(doc: PmNode, projectKeys: readonly string[]): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return;
    // Code stays code: no chips in code blocks or inline code.
    if (parent?.type.name === "codeBlock") return;
    if (node.marks.some((mark) => mark.type.name === "code")) return;
    let offset = 0;
    for (const segment of splitIssueRefs(node.text, projectKeys)) {
      if (segment.kind === "ref") {
        decorations.push(
          Decoration.inline(pos + offset, pos + offset + segment.text.length, {
            class: "issue-ref-chip",
          }),
        );
      }
      offset += segment.text.length;
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const IssueRefHighlight = Extension.create<{ projectKeys: string[] }>({
  name: "issueRefHighlight",
  addOptions() {
    return { projectKeys: [] };
  },
  addProseMirrorPlugins() {
    const { projectKeys } = this.options;
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => decorate(state.doc, projectKeys),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc, projectKeys) : old),
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ];
  },
});
