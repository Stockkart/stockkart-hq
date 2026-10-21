// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { type RichTextDoc } from "@/lib/rich-text";

import { RichTextView } from "./rich-text-view";

const doc = (...content: RichTextDoc["content"] & object): RichTextDoc => ({
  type: "doc",
  content,
});

describe("RichTextView (S-8, ISS-7)", () => {
  it("renders STK-123 as a link chip to the issue", () => {
    render(
      <RichTextView
        projectKeys={["STK"]}
        doc={doc({ type: "paragraph", content: [{ type: "text", text: "Blocked by STK-12." }] })}
      />,
    );
    const chip = screen.getByRole("link", { name: "STK-12" });
    expect(chip).toHaveAttribute("href", "/STK/issues/STK-12");
    expect(chip).toHaveClass("issue-ref-chip");
  });

  it("does not chip unknown prefixes or references inside code", () => {
    render(
      <RichTextView
        projectKeys={["STK"]}
        doc={doc(
          { type: "paragraph", content: [{ type: "text", text: "UTF-8 and ABC-1" }] },
          { type: "codeBlock", content: [{ type: "text", text: "git checkout STK-1" }] },
          {
            type: "paragraph",
            content: [{ type: "text", text: "STK-2", marks: [{ type: "code" }] }],
          },
        )}
      />,
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("keeps http(s) links and drops javascript: ones", () => {
    render(
      <RichTextView
        projectKeys={["STK"]}
        doc={doc({
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "safe",
              marks: [{ type: "link", attrs: { href: "https://x.test" } }],
            },
            {
              type: "text",
              text: " evil",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        })}
      />,
    );
    expect(screen.getByRole("link", { name: "safe" })).toHaveAttribute("href", "https://x.test");
    expect(screen.queryByRole("link", { name: "evil" })).toBeNull();
    expect(screen.getByText("evil")).toBeInTheDocument();
  });

  it("never interprets text as HTML", () => {
    const { container } = render(
      <RichTextView
        projectKeys={["STK"]}
        doc={doc({
          type: "paragraph",
          content: [{ type: "text", text: "<img src=x onerror=alert(1)>" }],
        })}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });

  it("shows the empty placeholder for an empty document", () => {
    render(
      <RichTextView
        projectKeys={["STK"]}
        doc={doc({ type: "paragraph" })}
        empty={<p>No description.</p>}
      />,
    );
    expect(screen.getByText("No description.")).toBeInTheDocument();
  });

  it("renders doc blocks: tables, callouts and mermaid source as text (DOC-1, DOC-7)", () => {
    const { container } = render(
      <RichTextView
        projectKeys={["STK"]}
        doc={doc(
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "H" }] }],
                  },
                ],
              },
            ],
          },
          {
            type: "callout",
            attrs: { tone: "warning" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Careful" }] }],
          },
          { type: "mermaid", attrs: { source: "graph TD; A-->B<script>" } },
        )}
      />,
    );
    expect(container.querySelector("th")).toHaveTextContent("H");
    expect(screen.getByRole("note")).toHaveAttribute("data-tone", "warning");
    expect(container.querySelector("figure code")).toHaveTextContent("graph TD; A-->B<script>");
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders only the children of node types no renderer is registered for", () => {
    const { container } = render(
      <RichTextView
        projectKeys={["STK"]}
        doc={doc(
          { type: "constructor", content: [{ type: "text", text: "kept" }] },
          { type: "futureNode", attrs: { html: "<b>x</b>" } },
        )}
      />,
    );
    expect(screen.getByText("kept")).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
  });
});
