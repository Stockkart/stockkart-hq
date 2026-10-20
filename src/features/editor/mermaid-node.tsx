"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { Trash2 } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/utils";

import { MermaidPreview } from "./mermaid-preview";

/**
 * DOC-7 Mermaid block. An atom node whose Mermaid source lives in `attrs.source` (so the
 * stored JSON is `{ type: "mermaid", attrs: { source } }` and `extractPlainText` can index
 * it). The node view splits into a code pane (a plain textarea) and a live preview.
 */

export const DEFAULT_MERMAID_SOURCE = "flowchart LR\n  A[Start] --> B[Finish]";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mermaid: {
      insertMermaid: (source?: string) => ReturnType;
    };
  }
}

function sourceOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function MermaidNodeView({
  node,
  updateAttributes,
  deleteNode,
  selected,
  editor,
}: ReactNodeViewProps) {
  const source = sourceOf(node.attrs.source);
  const codeId = useId();
  return (
    <NodeViewWrapper
      data-type="mermaid"
      contentEditable={false}
      className={cn(
        "my-3 overflow-hidden rounded-md border bg-background",
        selected && "ring-[3px] ring-ring/50",
      )}
    >
      <div className="flex items-center justify-between border-b bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
        <label htmlFor={codeId} className="font-medium">
          Mermaid
        </label>
        {editor.isEditable ? (
          <button
            type="button"
            aria-label="Delete diagram"
            onClick={() => deleteNode()}
            className="rounded p-1 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className="grid md:grid-cols-2 md:divide-x">
        <textarea
          id={codeId}
          value={source}
          readOnly={!editor.isEditable}
          spellCheck={false}
          rows={Math.min(20, Math.max(4, source.split("\n").length + 1))}
          onChange={(event) => updateAttributes({ source: event.target.value })}
          className="w-full resize-y bg-transparent p-2 font-mono text-xs outline-none focus-visible:bg-accent/30"
        />
        <MermaidPreview source={source} />
      </div>
    </NodeViewWrapper>
  );
}

export const MermaidBlock = Node.create({
  name: "mermaid",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-source") ?? "",
        renderHTML: (attributes) => ({ "data-source": sourceOf(attributes.source) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "mermaid" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView);
  },

  addCommands() {
    return {
      insertMermaid:
        (source = DEFAULT_MERMAID_SOURCE) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { source } }),
    };
  },
});
