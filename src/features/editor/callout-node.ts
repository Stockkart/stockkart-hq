import { mergeAttributes, Node } from "@tiptap/core";

/**
 * DOC-1 callout: a highlighted box around one or more blocks. Stored as
 * `{ type: "callout", attrs: { tone }, content: [...] }`.
 */

export const CALLOUT_TONES = ["info", "warning"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

export function calloutTone(value: unknown): CalloutTone {
  return value === "warning" ? "warning" : "info";
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Wraps the selected blocks in a callout, or unwraps them. */
      toggleCallout: () => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      tone: {
        default: "info",
        parseHTML: (element) => calloutTone(element.getAttribute("data-tone")),
        renderHTML: (attributes) => ({ "data-tone": calloutTone(attributes.tone) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'aside[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["aside", mergeAttributes(HTMLAttributes, { "data-type": "callout", role: "note" }), 0];
  },

  addCommands() {
    return {
      toggleCallout:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
    };
  },
});
