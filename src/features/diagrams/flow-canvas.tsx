"use client";

import "@xyflow/react/dist/style.css";

import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Viewport,
} from "@xyflow/react";
import { LayoutGrid, Link2, Unlink } from "lucide-react";
import {
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { callAction } from "@/features/issue/client-utils";
import {
  FLOW_GRID,
  FLOW_NODE_LABELS,
  FLOW_NODE_TYPES,
  type FlowNodeType,
} from "@/lib/diagrams/constants";
import { tidyLayout } from "@/lib/diagrams/layout";
import { ISSUE_KEY_INPUT_PATTERN } from "@/lib/diagrams/links";
import {
  FLOW_EDGE_LABEL_MAX,
  FLOW_LABEL_MAX,
  type FlowNodeLink,
  type FlowScene,
} from "@/lib/diagrams/scene";
import { FLOW_NODE_STYLE } from "@/lib/diagrams/flow-svg";
import { searchLinkableDocsAction } from "@/server/actions/diagrams";

import { sceneToEdges, sceneToNodes, toFlowScene } from "./flow-convert";
import {
  FLOW_NODE_COMPONENTS,
  FLOW_NODE_ICONS,
  type FlowNode,
  FlowNodeCtx,
  type FlowNodeContext,
} from "./flow-nodes";

export interface FlowCanvasProps {
  scene: FlowScene;
  onChange?: (scene: FlowScene) => void;
  readOnly?: boolean;
  dark: boolean;
  projectKey: string;
  /** DGM-7: open a linked issue or doc. */
  onOpenLink: (link: FlowNodeLink) => void;
}

/** MIME type of a palette item dragged onto the canvas (the value is the node type). */
const PALETTE_MIME = "application/x-hq-flow-node";

/** What counts as an edit: nodes and edges (the viewport is saved, but never alone). */
const signature = (scene: FlowScene) => JSON.stringify([scene.nodes, scene.edges]);

const isDefaultViewport = (viewport: Viewport) =>
  viewport.x === 0 && viewport.y === 0 && viewport.zoom === 1;

function isNodeType(value: string): value is FlowNodeType {
  return (FLOW_NODE_TYPES as readonly string[]).includes(value);
}

/**
 * DGM-2 flow editor (React Flow, client-only): typed nodes from a palette (click or drag),
 * labelled edges, minimap, controls, snap-to-grid and "Tidy" (dagre). Keyboard: Tab moves
 * through the nodes (focus selects), arrow keys move the selected node, Delete removes it,
 * Enter edits its label; the inspector edits the selected node or edge with plain inputs.
 */
export default function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowEditor {...props} />
    </ReactFlowProvider>
  );
}

function FlowEditor({
  scene,
  onChange,
  readOnly = false,
  dark,
  projectKey,
  onOpenLink,
}: FlowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(sceneToNodes(scene));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(sceneToEdges(scene));
  const [editingId, setEditingId] = useState<string | null>(null);
  const flow = useReactFlow<FlowNode, Edge>();
  const wrapper = useRef<HTMLDivElement>(null);
  const counter = useRef(0);

  // Report a change only when nodes or edges changed (not selection, drags in progress,
  // measured sizes, or panning and zooming: viewing must not create versions). The latest
  // viewport rides along with the next real change.
  const viewport = useRef<Viewport>(scene.viewport);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const [initialSignature] = useState(() =>
    signature(toFlowScene(sceneToNodes(scene), sceneToEdges(scene), scene.viewport)),
  );
  const lastSent = useRef(initialSignature);
  useEffect(() => {
    if (readOnly || !onChangeRef.current) return;
    if (nodes.some((node) => node.dragging)) return;
    const next = toFlowScene(nodes, edges, viewport.current);
    const json = signature(next);
    if (json === lastSent.current) return;
    lastSent.current = json;
    onChangeRef.current(next);
  }, [nodes, edges, readOnly]);

  const newId = (prefix: string) => {
    counter.current += 1;
    return `${prefix}-${Date.now().toString(36)}-${counter.current}`;
  };

  function addNode(type: FlowNodeType, at?: { x: number; y: number }) {
    const bounds = wrapper.current?.getBoundingClientRect();
    const position =
      at ??
      flow.screenToFlowPosition({
        x: (bounds?.left ?? 0) + (bounds?.width ?? 600) / 2,
        y: (bounds?.top ?? 0) + (bounds?.height ?? 400) / 2,
      });
    const id = newId("n");
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id,
        type,
        position: {
          x: Math.round(position.x / FLOW_GRID) * FLOW_GRID,
          y: Math.round(position.y / FLOW_GRID) * FLOW_GRID,
        },
        data: { label: FLOW_NODE_LABELS[type] },
        selected: true,
      },
    ]);
    setEditingId(id);
  }

  function updateNode(id: string, patch: (node: FlowNode) => FlowNode) {
    setNodes((current) => current.map((node) => (node.id === id ? patch(node) : node)));
  }

  function tidy() {
    const positions = tidyLayout(
      nodes.map((node) => ({
        id: node.id,
        width: node.measured?.width,
        height: node.measured?.height,
      })),
      edges,
    );
    setNodes((current) =>
      current.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })),
    );
    // After React Flow has the new positions.
    requestAnimationFrame(() => void flow.fitView({ padding: 0.2, duration: 200 }));
  }

  /** Back to the node after editing, so the keyboard flow continues where it was. */
  const refocus = (id: string) =>
    requestAnimationFrame(() =>
      wrapper.current
        ?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)
        ?.focus(),
    );

  const context: FlowNodeContext = {
    readOnly,
    editingId,
    commitLabel: (id, label) => {
      updateNode(id, (node) => ({
        ...node,
        data: { ...node.data, label: label.slice(0, FLOW_LABEL_MAX) },
      }));
      setEditingId(null);
      refocus(id);
    },
    cancelEdit: (id) => {
      setEditingId(null);
      refocus(id);
    },
    openLink: onOpenLink,
  };

  /** Focus on a node (Tab) selects it, so the arrow keys and Delete act on it. */
  function onFocusCapture(event: React.FocusEvent<HTMLDivElement>) {
    if (readOnly) return;
    const element = event.target instanceof HTMLElement ? event.target : null;
    if (!element?.classList.contains("react-flow__node")) return;
    const id = element.dataset.id;
    if (!id) return;
    setNodes((current) =>
      current.some((node) => node.id === id && node.selected) &&
      current.filter((node) => node.selected).length === 1
        ? current
        : current.map((node) => ({ ...node, selected: node.id === id })),
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (readOnly || event.key !== "Enter") return;
    const element = event.target instanceof HTMLElement ? event.target : null;
    if (!element?.classList.contains("react-flow__node")) return;
    const id = element.dataset.id;
    if (!id) return;
    event.preventDefault();
    setEditingId(id);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    const type = event.dataTransfer.getData(PALETTE_MIME);
    if (!isNodeType(type)) return;
    event.preventDefault();
    addNode(type, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }

  const selectedNodes = nodes.filter((node) => node.selected);
  const selectedEdges = edges.filter((edge) => edge.selected);
  const selectedNode =
    selectedNodes.length === 1 && selectedEdges.length === 0 ? selectedNodes[0] : undefined;
  const selectedEdge =
    selectedEdges.length === 1 && selectedNodes.length === 0 ? selectedEdges[0] : undefined;
  const nodeTypes = useMemo(() => FLOW_NODE_COMPONENTS, []);

  return (
    <FlowNodeCtx.Provider value={context}>
      <div className="flex size-full">
        {readOnly ? null : <Palette onAdd={(type) => addNode(type)} />}
        <div
          ref={wrapper}
          className="relative min-w-0 flex-1"
          onFocusCapture={onFocusCapture}
          onKeyDown={onKeyDown}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(PALETTE_MIME)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={onDrop}
        >
          <ReactFlow<FlowNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={readOnly ? undefined : onNodesChange}
            onEdgesChange={readOnly ? undefined : onEdgesChange}
            onConnect={(connection: Connection) =>
              setEdges((current) =>
                addEdge(
                  { ...connection, id: newId("e"), markerEnd: { type: MarkerType.ArrowClosed } },
                  current,
                ),
              )
            }
            onNodeDoubleClick={(_event, node) => {
              if (!readOnly) setEditingId(node.id);
            }}
            onMoveEnd={(_event, next) => {
              viewport.current = next;
            }}
            defaultViewport={scene.viewport}
            // A scene that never stored a view (e.g. made elsewhere) is fitted on open.
            fitView={isDefaultViewport(scene.viewport) && scene.nodes.length > 0}
            snapToGrid
            snapGrid={[FLOW_GRID, FLOW_GRID]}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            elementsSelectable={!readOnly}
            nodesFocusable
            edgesFocusable={!readOnly}
            deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
            colorMode={dark ? "dark" : "light"}
          >
            <Background gap={FLOW_GRID} />
            <MiniMap
              pannable
              zoomable
              ariaLabel="Mini map"
              nodeColor={(node) => {
                const type = node.type ?? "";
                return isNodeType(type) ? FLOW_NODE_STYLE[type].stroke : "#999";
              }}
            />
            <Controls showInteractive={!readOnly} />
            {readOnly ? null : (
              <Panel position="top-right" className="flex flex-col items-end gap-2">
                <Button size="sm" variant="outline" onClick={tidy} disabled={nodes.length === 0}>
                  <LayoutGrid aria-hidden="true" />
                  Tidy
                </Button>
                {selectedNode ? (
                  <NodeInspector
                    key={selectedNode.id}
                    node={selectedNode}
                    projectKey={projectKey}
                    onChange={(patch) => updateNode(selectedNode.id, patch)}
                  />
                ) : selectedEdge ? (
                  <EdgeInspector
                    key={selectedEdge.id}
                    edge={selectedEdge}
                    onLabel={(label) =>
                      setEdges((current) =>
                        current.map((edge) =>
                          edge.id === selectedEdge.id
                            ? { ...edge, label: label || undefined }
                            : edge,
                        ),
                      )
                    }
                  />
                ) : null}
              </Panel>
            )}
          </ReactFlow>
        </div>
      </div>
    </FlowNodeCtx.Provider>
  );
}

/** Add a node: click (it appears in the middle of the view) or drag it onto the canvas. */
function Palette({ onAdd }: { onAdd: (type: FlowNodeType) => void }) {
  return (
    <aside
      aria-label="Node palette"
      className="flex w-36 shrink-0 flex-col gap-1 border-r bg-background p-2"
    >
      <h2 className="px-1 pb-1 text-xs font-semibold text-muted-foreground">Add node</h2>
      {FLOW_NODE_TYPES.map((type) => {
        const Icon = FLOW_NODE_ICONS[type];
        return (
          <button
            key={type}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(PALETTE_MIME, type);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onAdd(type)}
            className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            style={{ borderLeft: `4px solid ${FLOW_NODE_STYLE[type].stroke}` }}
          >
            <Icon
              aria-hidden="true"
              className="size-4"
              style={{ color: FLOW_NODE_STYLE[type].stroke }}
            />
            {FLOW_NODE_LABELS[type]}
          </button>
        );
      })}
    </aside>
  );
}

function NodeInspector({
  node,
  projectKey,
  onChange,
}: {
  node: FlowNode;
  projectKey: string;
  onChange: (patch: (node: FlowNode) => FlowNode) => void;
}) {
  const ids = { label: useId(), type: useId(), issue: useId(), doc: useId() };
  const [issueKey, setIssueKey] = useState(
    node.data.link?.kind === "issue" ? node.data.link.key : "",
  );
  const link = node.data.link;
  const issueValid = ISSUE_KEY_INPUT_PATTERN.test(issueKey.trim().toUpperCase());

  function setLink(next: FlowNodeLink | undefined) {
    onChange((current) => ({
      ...current,
      data: next ? { label: current.data.label, link: next } : { label: current.data.label },
    }));
  }

  return (
    <section
      aria-label="Selected node"
      className="nodrag nowheel flex w-64 flex-col gap-2 rounded-md border bg-background p-3 text-sm shadow-md"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.label} className="text-xs text-muted-foreground">
          Label
        </label>
        <Input
          id={ids.label}
          value={node.data.label}
          maxLength={FLOW_LABEL_MAX}
          onChange={(event) => {
            const label = event.target.value;
            onChange((current) => ({ ...current, data: { ...current.data, label } }));
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.type} className="text-xs text-muted-foreground">
          Type
        </label>
        <Select
          id={ids.type}
          label="Type"
          value={node.type ?? "service"}
          options={FLOW_NODE_TYPES.map((value) => ({ value, label: FLOW_NODE_LABELS[value] }))}
          onChange={(next) => {
            if (next) onChange((current) => ({ ...current, type: next }));
          }}
        />
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs text-muted-foreground">
          Link (click the node’s icon to open)
        </legend>
        {link ? (
          <div className="flex items-center gap-2">
            <Link2 aria-hidden="true" className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">
              {link.kind === "issue" ? link.key : link.title}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setLink(undefined)}>
              <Unlink aria-hidden="true" />
              Remove
            </Button>
          </div>
        ) : (
          <>
            <form
              className="flex items-end gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                if (issueValid) setLink({ kind: "issue", key: issueKey.trim().toUpperCase() });
              }}
            >
              <div className="flex flex-1 flex-col gap-1">
                <label htmlFor={ids.issue} className="sr-only">
                  Issue key
                </label>
                <Input
                  id={ids.issue}
                  value={issueKey}
                  placeholder={`${projectKey}-12`}
                  maxLength={20}
                  onChange={(event) => setIssueKey(event.target.value)}
                />
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={!issueValid}>
                Link issue
              </Button>
            </form>
            <label htmlFor={ids.doc} className="sr-only">
              Doc
            </label>
            <Combobox
              id={ids.doc}
              label="Link a doc"
              value={null}
              placeholder="…or link a doc"
              searchPlaceholder="Doc title…"
              emptyText="No matching doc"
              align="end"
              loadOptions={async (query) => {
                const docs = await callAction(() =>
                  searchLinkableDocsAction({ projectKey, q: query }),
                );
                return (docs ?? []).map((doc) => ({ value: doc.id, label: doc.title }));
              }}
              onChange={(value, option) => {
                if (value && option) setLink({ kind: "doc", id: value, title: option.label });
              }}
            />
          </>
        )}
      </fieldset>
    </section>
  );
}

function EdgeInspector({ edge, onLabel }: { edge: Edge; onLabel: (label: string) => void }) {
  const id = useId();
  return (
    <section
      aria-label="Selected edge"
      className="nodrag nowheel flex w-64 flex-col gap-1 rounded-md border bg-background p-3 text-sm shadow-md"
    >
      <label htmlFor={id} className="text-xs text-muted-foreground">
        Edge label
      </label>
      <Input
        id={id}
        autoFocus
        value={typeof edge.label === "string" ? edge.label : ""}
        maxLength={FLOW_EDGE_LABEL_MAX}
        placeholder="e.g. HTTPS"
        onChange={(event) => onLabel(event.target.value)}
      />
    </section>
  );
}
