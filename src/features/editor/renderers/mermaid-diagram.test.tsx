// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** mermaid needs a real layout engine; jsdom gets a stand-in with the same API. */
const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

const { RichTextView } = await import("../rich-text-view");

const doc = (source: string) => ({
  type: "doc",
  content: [{ type: "mermaid", attrs: { source } }],
});

describe("Mermaid in the read-only view (DOC-7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mermaid.parse.mockResolvedValue({ diagramType: "flowchart" });
    mermaid.render.mockResolvedValue({ svg: "<svg><g><text>A</text></g></svg>" });
  });

  it("renders the diagram, with the source behind a toggle", async () => {
    const { container } = render(<RichTextView doc={doc("graph TD; A-->B")} />);
    const diagram = container.querySelector<HTMLElement>('[aria-label="Diagram preview"]');
    expect(diagram).not.toBeNull();
    await waitFor(() => expect(diagram?.shadowRoot?.querySelector("svg")).toBeTruthy(), {
      timeout: 3000,
    });
    expect(diagram?.hidden).toBe(false);
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), "graph TD; A-->B");
    expect(screen.getByText("Show source")).toBeInTheDocument();
    expect(screen.getByText("graph TD; A-->B", { selector: "code" })).toBeInTheDocument();
  });

  it("shows the inline error for invalid syntax instead of a diagram", async () => {
    mermaid.parse.mockRejectedValue(new Error("Parse error on line 1"));
    render(<RichTextView doc={doc("not a diagram")} />);
    expect(await screen.findByRole("alert", undefined, { timeout: 3000 })).toHaveTextContent(
      "Parse error",
    );
  });
});
