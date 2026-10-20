// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type RichTextDoc } from "@/lib/rich-text";

/** mermaid needs a real browser layout engine; jsdom gets a stand-in with the same API. */
const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn<(source: string) => Promise<unknown>>(),
  render: vi.fn<(id: string, source: string) => Promise<{ svg: string }>>(),
}));
vi.mock("mermaid", () => ({ default: mermaidMock }));

const { MermaidPreview } = await import("./mermaid-preview");
const { RichTextEditor } = await import("./rich-text-editor");

function behaveLikeMermaid() {
  mermaidMock.parse.mockImplementation(async (source) => {
    if (source.includes("oops")) throw new Error("Parse error on line 2: unexpected oops");
    return { diagramType: "flowchart" };
  });
  mermaidMock.render.mockImplementation(async (id) => ({
    // A hostile payload: DOMPurify must strip the script and the event handler.
    svg: `<svg id="${id}" xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><g><text>Start</text></g></svg>`,
  }));
}

describe("MermaidPreview (DOC-7)", () => {
  beforeEach(() => {
    mermaidMock.parse.mockReset();
    mermaidMock.render.mockReset();
    behaveLikeMermaid();
  });

  it("renders sanitised SVG from strict-mode mermaid, isolated in a shadow root", async () => {
    render(<MermaidPreview source={"flowchart LR\n  A --> B"} />);
    const preview = await screen.findByRole("img", { name: "Diagram preview" });
    await waitFor(() => expect(preview.shadowRoot?.querySelector("svg")).toBeTruthy());
    const shadow = preview.shadowRoot;
    expect(shadow?.textContent).toContain("Start");
    const svg = shadow?.querySelector("svg");
    expect(svg?.getAttribute("onload")).toBeNull();
    expect(shadow?.querySelector("script")).toBeNull();
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: "strict",
        secure: expect.arrayContaining(["securityLevel", "themeCSS"]),
      }),
    );
  });

  it("shows invalid syntax as an inline error instead of throwing", async () => {
    render(<MermaidPreview source={"flowchart LR\n  oops"} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Diagram error: Parse error on line 2: unexpected oops",
    );
    expect(mermaidMock.render).not.toHaveBeenCalled();
  });

  it("prompts for a diagram when the source is empty", async () => {
    render(<MermaidPreview source="  " />);
    expect(await screen.findByText("Write a diagram to see it here.")).toBeInTheDocument();
    expect(mermaidMock.parse).not.toHaveBeenCalled();
  });
});

describe("RichTextEditor doc variant (DOC-1, DOC-7)", () => {
  beforeEach(() => {
    mermaidMock.parse.mockReset();
    mermaidMock.render.mockReset();
    behaveLikeMermaid();
  });

  const content: RichTextDoc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
      { type: "mermaid", attrs: { source: "flowchart LR\n  oops" } },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Head" }] }],
              },
            ],
          },
        ],
      },
      {
        type: "callout",
        attrs: { tone: "info" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "Note this" }] }],
      },
    ],
  };

  it("shows mermaid code and preview, tables and callouts; bad syntax does not crash", async () => {
    const onChange = vi.fn();
    render(
      <RichTextEditor
        variant="doc"
        initialContent={content}
        onChange={onChange}
        projectKeys={["STK"]}
        label="Doc body"
      />,
    );
    const box = await screen.findByRole("textbox", { name: "Doc body" });
    const code = await screen.findByRole("textbox", { name: "Mermaid" });
    expect(code).toHaveValue("flowchart LR\n  oops");
    expect(await screen.findByRole("alert")).toHaveTextContent("unexpected oops");
    expect(box.querySelector("th")).toHaveTextContent("Head");
    expect(box.querySelector('aside[data-type="callout"]')).toHaveTextContent("Note this");
    expect(screen.getByRole("button", { name: "Insert table" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mermaid diagram" })).toBeInTheDocument();

    // Fixing the code updates the node's source (and so the saved JSON) and the preview.
    fireEvent.change(code, { target: { value: "flowchart LR\n  A --> B" } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved = onChange.mock.lastCall?.[0] as RichTextDoc | undefined;
    expect(saved?.content?.[1]).toEqual({
      type: "mermaid",
      attrs: { source: "flowchart LR\n  A --> B" },
    });
    expect(await screen.findByRole("img", { name: "Diagram preview" })).toBeInTheDocument();
  });

  it("keeps the basic toolbar for issues and comments", async () => {
    render(
      <RichTextEditor initialContent={null} onChange={() => {}} projectKeys={[]} label="Comment" />,
    );
    await screen.findByRole("textbox", { name: "Comment" });
    expect(screen.queryByRole("button", { name: "Insert table" })).toBeNull();
    expect(screen.getByRole("button", { name: "Heading" })).toBeInTheDocument();
  });
});
