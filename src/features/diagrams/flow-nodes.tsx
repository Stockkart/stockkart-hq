"use client";

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import {
  Database,
  ExternalLink,
  Globe,
  Layers,
  type LucideIcon,
  Server,
  Split,
  StickyNote,
  UserRound,
} from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import {
  FLOW_NODE_HEIGHT,
  FLOW_NODE_LABELS,
  FLOW_NODE_WIDTH,
  type FlowNodeType,
} from "@/lib/diagrams/constants";
import { FLOW_NODE_STYLE } from "@/lib/diagrams/flow-svg";
import { FLOW_LABEL_MAX, type FlowNodeLink } from "@/lib/diagrams/scene";
import { cn } from "@/lib/utils";

/** DGM-2 typed nodes: a distinct icon and colour each, and an editable label. */

export type FlowNodeData = { label: string; link?: FlowNodeLink };
export type FlowNode = Node<FlowNodeData, FlowNodeType>;

export const FLOW_NODE_ICONS: Record<FlowNodeType, LucideIcon> = {
  service: Server,
  database: Database,
  queue: Layers,
  external: Globe,
  actor: UserRound,
  decision: Split,
  note: StickyNote,
};

/** What a node needs from its canvas: inline label editing and opening its link (DGM-7). */
export interface FlowNodeContext {
  readOnly: boolean;
  editingId: string | null;
  commitLabel: (id: string, label: string) => void;
  cancelEdit: () => void;
  openLink: (link: FlowNodeLink) => void;
}

export const FlowNodeCtx = createContext<FlowNodeContext>({
  readOnly: true,
  editingId: null,
  commitLabel: () => {},
  cancelEdit: () => {},
  openLink: () => {},
});

function LabelEditor({ id, label }: { id: string; label: string }) {
  const { commitLabel, cancelEdit } = useContext(FlowNodeCtx);
  const [value, setValue] = useState(label);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      aria-label="Node label"
      value={value}
      maxLength={FLOW_LABEL_MAX}
      // `nodrag`: typing or selecting text must not drag the node.
      className="nodrag w-full rounded border bg-background px-1 text-center text-sm text-foreground outline-none"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => commitLabel(id, value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") commitLabel(id, value);
        if (event.key === "Escape") cancelEdit();
      }}
    />
  );
}

function TypedNode({ id, type, data, selected }: NodeProps<FlowNode>) {
  const { readOnly, editingId, openLink } = useContext(FlowNodeCtx);
  const style = FLOW_NODE_STYLE[type];
  const Icon = FLOW_NODE_ICONS[type];
  const editing = editingId === id;
  return (
    <div
      className={cn(
        "flex min-h-14 items-center gap-2 border-2 px-2 py-1.5 text-sm text-gray-900 shadow-sm",
        type === "actor" ? "rounded-full px-4" : "rounded-md",
        type === "external" && "border-dashed",
        type === "decision" && "rounded-xl",
        selected && "ring-2 ring-ring ring-offset-1",
      )}
      style={{
        width: FLOW_NODE_WIDTH,
        minHeight: FLOW_NODE_HEIGHT,
        backgroundColor: style.fill,
        borderColor: style.stroke,
      }}
    >
      <Handle type="target" position={Position.Left} isConnectable={!readOnly} />
      <Icon aria-hidden="true" className="size-4 shrink-0" style={{ color: style.stroke }} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] tracking-wide uppercase opacity-70">
          {FLOW_NODE_LABELS[type]}
        </span>
        {editing ? (
          <LabelEditor id={id} label={data.label} />
        ) : (
          <span className="line-clamp-2 break-words">{data.label || "Untitled"}</span>
        )}
      </span>
      {data.link ? (
        <button
          type="button"
          className="nodrag rounded p-0.5 hover:bg-black/10"
          aria-label={
            data.link.kind === "issue" ? `Open ${data.link.key}` : `Open ${data.link.title}`
          }
          title={data.link.kind === "issue" ? data.link.key : data.link.title}
          onClick={(event) => {
            event.stopPropagation();
            if (data.link) openLink(data.link);
          }}
        >
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
      <Handle type="source" position={Position.Right} isConnectable={!readOnly} />
    </div>
  );
}

/** One component for every type; it reads its look from the node's `type`. */
export const FLOW_NODE_COMPONENTS = {
  service: TypedNode,
  database: TypedNode,
  queue: TypedNode,
  external: TypedNode,
  actor: TypedNode,
  decision: TypedNode,
  note: TypedNode,
} satisfies Record<FlowNodeType, typeof TypedNode>;
