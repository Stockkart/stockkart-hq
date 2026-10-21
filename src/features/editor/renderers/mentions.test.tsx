// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { extractPlainText, type RichTextDoc } from "@/lib/rich-text";

import { RichTextView } from "../rich-text-view";

const ADA = "aaaaaaaa-0000-4000-8000-000000000001";

const withMention = (attrs: Record<string, unknown>): RichTextDoc => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Ping " },
        { type: "mention", attrs },
      ],
    },
  ],
});

describe("@mention in the read-only view and plain text (ISS-7)", () => {
  it("renders @Name as a chip carrying the user id", () => {
    render(<RichTextView projectKeys={[]} doc={withMention({ id: ADA, label: "Ada Lovelace" })} />);
    const chip = screen.getByText("@Ada Lovelace");
    expect(chip).toHaveAttribute("data-type", "mention");
    expect(chip).toHaveAttribute("data-id", ADA);
    expect(chip).toHaveClass("mention");
  });

  it("drops a malformed id and a missing label safely", () => {
    render(<RichTextView projectKeys={[]} doc={withMention({ id: '"><script>', label: 7 })} />);
    const chip = screen.getByText("@someone");
    expect(chip).not.toHaveAttribute("data-id");
  });

  it("extracts @Name as plain text (search, previews)", () => {
    expect(extractPlainText(withMention({ id: ADA, label: "Ada Lovelace" }))).toBe(
      "Ping @Ada Lovelace",
    );
    expect(extractPlainText(withMention({ id: ADA }))).toBe("Ping @someone");
  });
});
