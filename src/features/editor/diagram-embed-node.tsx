"use client";

import { mergeAttributes, Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef } from "react";

import { Combobox } from "@/components/ui/combobox";
import { DiagramThumbnail } from "@/features/diagrams/diagram-thumbnail";
import { callAction } from "@/features/issue/client-utils";
import { DEFAULT_PROJECT_KEY } from "@/features/shell/nav-items";
import { DIAGRAM_KIND_LABELS } from "@/lib/diagrams/constants";
import { diagramPath } from "@/lib/diagrams/links";
import { type DiagramOption } from "@/lib/diagrams/views";
import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import { DIAGRAM_EMBED_NODE, diagramEmbedAttrs } from "@/lib/rich-text-nodes/diagram-embed";
import { cn } from "@/lib/utils";
import { searchDiagramOptionsAction } from "@/server/actions/diagrams";

/**
 * DOC-8 diagram embed: an atom node `{ diagramId, title, projectKey, kind }`. Inserted
 * empty, it shows an "Insert diagram" picker (Combobox); once chosen it shows the live
 * thumbnail and the title, and clicking opens the diagram.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    diagramEmbed: {
      insertDiagramEmbed: () => ReturnType;
    };
  }
}

/** The project of the page the editor is on (`/STK/docs/…`), for the picker. */
function useProjectKey(): string {
  const segment = usePathname().split("/")[1] ?? "";
  return PROJECT_KEY_PATTERN.test(segment) ? segment : DEFAULT_PROJECT_KEY;
}

function DiagramEmbedView({
  node,
  updateAttributes,
  deleteNode,
  selected,
  editor,
}: ReactNodeViewProps) {
  const attrs = diagramEmbedAttrs(node);
  const projectKey = useProjectKey();
  const pickerId = useId();
  const editable = editor.isEditable;
  // What the picker last offered, so a choice keeps its project and kind.
  const offered = useRef(new Map<string, DiagramOption>());

  return (
    <NodeViewWrapper
      data-type={DIAGRAM_EMBED_NODE}
      contentEditable={false}
      className={cn(
        "my-3 max-w-md overflow-hidden rounded-md border bg-background",
        selected && "ring-[3px] ring-ring/50",
      )}
    >
      <div className="flex items-center justify-between border-b bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
        <span className="font-medium">Diagram</span>
        {editable ? (
          <button
            type="button"
            aria-label="Remove diagram embed"
            onClick={() => deleteNode()}
            className="rounded p-1 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </div>
      {attrs.diagramId && attrs.projectKey ? (
        <Link
          href={diagramPath(attrs.projectKey, attrs.diagramId)}
          className="flex flex-col gap-1 p-2 outline-none hover:bg-accent/30 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <DiagramThumbnail diagramId={attrs.diagramId} kind={attrs.kind} />
          <span className="text-sm">
            <span className="font-medium">{attrs.title || "Diagram"}</span>
            {attrs.kind ? (
              <span className="text-xs text-muted-foreground">
                {" "}
                · {DIAGRAM_KIND_LABELS[attrs.kind]}
              </span>
            ) : null}
          </span>
        </Link>
      ) : editable ? (
        <div className="flex flex-col gap-1 p-2">
          <label htmlFor={pickerId} className="text-xs text-muted-foreground">
            Insert diagram
          </label>
          <Combobox<string>
            id={pickerId}
            label="Insert diagram"
            className="w-full"
            value={null}
            placeholder="Choose a diagram…"
            searchPlaceholder="Diagram title…"
            emptyText="No matching diagram"
            loadOptions={async (query) => {
              const options = await callAction(() =>
                searchDiagramOptionsAction({ projectKey, q: query }),
              );
              for (const option of options ?? []) offered.current.set(option.id, option);
              return (options ?? []).map((option) => ({
                value: option.id,
                label: option.title,
                detail: DIAGRAM_KIND_LABELS[option.kind],
              }));
            }}
            onChange={(value, option) => {
              if (!value || !option) return;
              const picked = offered.current.get(value);
              updateAttributes({
                diagramId: value,
                title: option.label,
                projectKey: picked?.projectKey ?? projectKey,
                kind: picked?.kind ?? null,
              });
            }}
          />
        </div>
      ) : (
        <p className="p-2 text-sm text-muted-foreground">No diagram chosen.</p>
      )}
    </NodeViewWrapper>
  );
}

export const DiagramEmbed = Node.create({
  name: DIAGRAM_EMBED_NODE,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    const attr = (key: string, data: string) => ({
      default: null,
      parseHTML: (element: HTMLElement) => element.getAttribute(`data-${data}`),
      renderHTML: (attributes: Record<string, unknown>) => {
        const value = attributes[key];
        return typeof value === "string" ? { [`data-${data}`]: value } : {};
      },
    });
    return {
      diagramId: attr("diagramId", "diagram-id"),
      title: attr("title", "title"),
      projectKey: attr("projectKey", "project-key"),
      kind: attr("kind", "kind"),
    };
  },

  parseHTML() {
    return [{ tag: `div[data-type="${DIAGRAM_EMBED_NODE}"]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": DIAGRAM_EMBED_NODE })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DiagramEmbedView);
  },

  addCommands() {
    return {
      insertDiagramEmbed:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { diagramId: null } }),
    };
  },
});
