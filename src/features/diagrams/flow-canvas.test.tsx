// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type FlowScene } from "@/lib/diagrams/scene";

vi.mock("@/server/actions/diagrams", () => ({ searchLinkableDocsAction: vi.fn() }));

const { default: FlowCanvas } = await import("./flow-canvas");

beforeEach(() => {
  // React Flow measures nodes; jsdom has no layout.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      m22 = 1;
    },
  );
});

const scene: FlowScene = {
  nodes: [
    { id: "api", type: "service", position: { x: 0, y: 0 }, data: { label: "inventory-api" } },
    { id: "db", type: "database", position: { x: 240, y: 0 }, data: { label: "MongoDB" } },
  ],
  edges: [{ id: "e", source: "api", target: "db", label: "queries" }],
  viewport: { x: 0, y: 0, zoom: 1 },
};

function setup() {
  const onChange = vi.fn();
  render(
    <div style={{ width: 800, height: 600 }}>
      <FlowCanvas scene={scene} onChange={onChange} projectKey="STK" onOpenLink={vi.fn()} />
    </div>,
  );
  return { onChange };
}

describe("FlowCanvas (DGM-2)", () => {
  it("shows typed nodes and does not report the initial scene as a change", async () => {
    const { onChange } = setup();
    expect(await screen.findByText("inventory-api")).toBeInTheDocument();
    expect(screen.getByText("MongoDB")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Node palette" })).toBeInTheDocument();
    await act(async () => {});
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adds a node from the palette (click) and reports the new scene", async () => {
    const { onChange } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Queue" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const latest: FlowScene = onChange.mock.calls.at(-1)?.[0];
    expect(latest.nodes.map((node) => node.type)).toEqual(["service", "database", "queue"]);
    // The new node opens for editing its label.
    // (jsdom cannot measure nodes, so React Flow keeps them visibility-hidden: query by label.)
    expect(screen.getByLabelText("Node label")).toHaveFocus();
  });

  it("edits a focused node's label with Enter (keyboard)", async () => {
    const { onChange } = setup();
    await screen.findByText("inventory-api");
    const node = document.querySelector<HTMLElement>('.react-flow__node[data-id="api"]');
    expect(node).not.toBeNull();
    if (!node) return;
    act(() => node.focus());
    fireEvent.keyDown(node, { key: "Enter" });
    const input = await screen.findByLabelText("Node label");
    fireEvent.change(input, { target: { value: "orders-api" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0].nodes[0].data.label).toBe("orders-api"),
    );
  });
});
