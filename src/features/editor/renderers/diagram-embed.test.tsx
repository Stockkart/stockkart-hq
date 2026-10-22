// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { extractPlainText, type RichTextDoc } from "@/lib/rich-text";
import { diagramEmbedAttrs } from "@/lib/rich-text-nodes/diagram-embed";

import { RichTextView } from "../rich-text-view";

const ID = "0c6f7a9e-5b1d-4c3a-9e2f-1a2b3c4d5e6f";
const embed = (attrs: Record<string, unknown>): RichTextDoc => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Before" }] },
    { type: "diagramEmbed", attrs },
    { type: "paragraph", content: [{ type: "text", text: "After" }] },
  ],
});

describe("diagramEmbed node (DOC-8)", () => {
  it("renders the live thumbnail and the title, linking to the diagram", () => {
    render(
      <RichTextView
        projectKeys={["STK"]}
        doc={embed({ diagramId: ID, title: "OCR upload flow", projectKey: "STK", kind: "flow" })}
      />,
    );
    const link = screen.getByRole("link", { name: /OCR upload flow/ });
    expect(link).toHaveAttribute("href", `/STK/diagrams/${ID}`);
    expect(link).toHaveTextContent("Flow");
    const image = link.querySelector("img");
    expect(image).toHaveAttribute("src", `/api/files/thumbnail/diagram/${ID}`);
    // No thumbnail (storage off, never saved): the kind icon instead of a broken image.
    if (image) fireEvent.error(image);
    expect(link.querySelector("img")).toBeNull();
  });

  it("renders nothing for malformed attrs, and never a link built from them", () => {
    const { container } = render(
      <RichTextView
        projectKeys={["STK"]}
        doc={embed({ diagramId: "javascript:alert(1)", title: "x", projectKey: "STK" })}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(container).toHaveTextContent("BeforeAfter");
    render(
      <RichTextView
        projectKeys={["STK"]}
        doc={embed({ diagramId: ID, title: "x", projectKey: "../../evil" })}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("contributes the diagram title to the plain text, as its own line, never as a mention", () => {
    const doc = embed({
      diagramId: ID,
      title: "STK-12 upload flow",
      projectKey: "STK",
      kind: "flow",
    });
    expect(extractPlainText(doc)).toBe("Before\nSTK-12 upload flow\nAfter");
    expect(extractPlainText(doc, { skipCode: true })).toBe("Before\nAfter");
    expect(extractPlainText(embed({ diagramId: null }))).toBe("Before\nAfter");
  });

  it("validates every attr", () => {
    expect(
      diagramEmbedAttrs({
        attrs: { diagramId: ID.toUpperCase(), title: 7, projectKey: "stk", kind: "pie" },
      }),
    ).toEqual({ diagramId: ID, title: "", projectKey: null, kind: null });
  });
});
