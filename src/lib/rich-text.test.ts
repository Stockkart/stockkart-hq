import { describe, expect, it } from "vitest";

import { extractPlainText, type RichTextDoc } from "./rich-text";
import { PLAIN_TEXT_RULES } from "./rich-text-nodes";

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("extractPlainText with the node registry", () => {
  const doc: RichTextDoc = {
    type: "doc",
    content: [
      p("Intro STK-1"),
      { type: "callout", attrs: { tone: "info" }, content: [p("Note STK-2")] },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [p("Head")] },
              { type: "tableCell", content: [p("Cell")] },
            ],
          },
        ],
      },
      { type: "mermaid", attrs: { source: "flowchart LR\n  STK-3 --> B" } },
      { type: "codeBlock", content: [{ type: "text", text: "STK-4" }] },
    ],
  };

  it("puts callouts, table cells and Mermaid source on their own lines", () => {
    expect(extractPlainText(doc)).toBe(
      ["Intro STK-1", "Note STK-2", "Head", "Cell", "flowchart LR\n  STK-3 --> B", "STK-4"].join(
        "\n",
      ),
    );
  });

  it("leaves Mermaid source and code out with skipCode", () => {
    expect(extractPlainText(doc, { skipCode: true })).toBe("Intro STK-1\nNote STK-2\nHead\nCell");
  });

  it("registers the doc blocks, and nothing under prototype keys", () => {
    expect([...PLAIN_TEXT_RULES.keys()]).toEqual([
      "callout",
      "table",
      "tableRow",
      "tableCell",
      "tableHeader",
      "mermaid",
      "image",
      "fileAttachment",
    ]);
    expect(PLAIN_TEXT_RULES.get("constructor")).toBeUndefined();
    expect(
      extractPlainText({ type: "doc", content: [{ type: "constructor", content: [p("ok")] }] }),
    ).toBe("ok");
  });
});
