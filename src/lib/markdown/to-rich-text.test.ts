import { describe, expect, it } from "vitest";

import { parseAdrStatus } from "@/lib/docs/adr";
import { extractPlainText, richTextDocSchema } from "@/lib/rich-text";

import {
  HQ_ONLY_LINKS_NOTE,
  markdownCellToNodes,
  markdownInlineToNodes,
  markdownToRichText,
  sectionText,
  takeTitle,
} from "./to-rich-text";

/** Synthetic markdown only (S-7): no handbook content is ever copied into the repo. */

const blocks = (markdown: string) => markdownToRichText(markdown).content ?? [];

describe("markdownToRichText (IMP-2)", () => {
  it("converts headings (h4+ capped at 3) and paragraphs with inline marks", () => {
    expect(
      blocks("# One\n\n## Two\n\n#### Four\n\nA **bold** _it_ ~~gone~~ `code` line\nwraps"),
    ).toEqual([
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "One" }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Two" }] },
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Four" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "A " },
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " " },
          { type: "text", text: "it", marks: [{ type: "italic" }] },
          { type: "text", text: " " },
          { type: "text", text: "gone", marks: [{ type: "strike" }] },
          { type: "text", text: " " },
          { type: "text", text: "code", marks: [{ type: "code" }] },
          { type: "text", text: " line wraps" },
        ],
      },
    ]);
  });

  it("keeps safe links and drops unsafe ones", () => {
    const [paragraph] = blocks(
      "[ok](https://example.test/a) [rel](other.md) [bad](ftp://example.test) [js](javascript:alert(1))",
    );
    expect(paragraph?.content).toEqual([
      {
        type: "text",
        text: "ok",
        marks: [{ type: "link", attrs: { href: "https://example.test/a" } }],
      },
      { type: "text", text: " " },
      { type: "text", text: "rel", marks: [{ type: "link", attrs: { href: "other.md" } }] },
      // markdown-it already refuses javascript: links; isSafeHref drops other schemes.
      { type: "text", text: " bad [js](javascript:alert(1))" },
    ]);
  });

  it("converts bullet, numbered and nested lists", () => {
    expect(blocks("1. first\n2. second\n   - nested\n\n3) other\n")[0]).toEqual({
      type: "orderedList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }],
        },
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "second" }] },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "nested" }] }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(blocks("5. five\n6. six")[0]?.attrs).toEqual({ start: 5 });
  });

  it("turns [ ] / [x] bullet lists into task lists", () => {
    expect(blocks("- [ ] todo\n- [x] **done** item\n")).toEqual([
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [{ type: "paragraph", content: [{ type: "text", text: "todo" }] }],
          },
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "done", marks: [{ type: "bold" }] },
                  { type: "text", text: " item" },
                ],
              },
            ],
          },
        ],
      },
    ]);
    // A list with only some task markers stays a plain list.
    expect(blocks("- [ ] a\n- b")[0]?.type).toBe("bulletList");
  });

  it("converts tables with header and body cells", () => {
    expect(blocks("| Name | Value |\n| --- | --- |\n| a | `b` |\n| | c |")).toEqual([
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Name" }] }],
              },
              {
                type: "tableHeader",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Value" }] }],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
              },
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "b", marks: [{ type: "code" }] }],
                  },
                ],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph" }] },
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "c" }] }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("converts code fences with their language, and mermaid fences to Mermaid blocks", () => {
    expect(
      blocks(
        "```ts\nconst a = 1;\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n\n```\n```",
      ),
    ).toEqual([
      {
        type: "codeBlock",
        attrs: { language: "ts" },
        content: [{ type: "text", text: "const a = 1;" }],
      },
      { type: "mermaid", attrs: { source: "sequenceDiagram\n  A->>B: hi" } },
      { type: "codeBlock", attrs: { language: null } },
    ]);
  });

  it("converts blockquotes, rules and hard breaks; raw HTML stays text", () => {
    expect(blocks("> quoted\n\n---\n\nline  \nbreak <b>x</b>")).toEqual([
      {
        type: "blockquote",
        content: [{ type: "paragraph", content: [{ type: "text", text: "quoted" }] }],
      },
      { type: "horizontalRule" },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "line" },
          { type: "hardBreak" },
          { type: "text", text: "break <b>x</b>" },
        ],
      },
    ]);
  });

  it("always produces a document the editor schema accepts", () => {
    const doc = markdownToRichText(
      "# T\n\n- [ ] x\n\n| a |\n|---|\n| b |\n\n```mermaid\ngraph TD\n```\n",
    );
    expect(richTextDocSchema.safeParse(doc).success).toBe(true);
    expect(markdownToRichText("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    // Mermaid source is part of the searchable text.
    expect(extractPlainText(doc)).toContain("graph TD");
  });
});

describe("takeTitle and sectionText", () => {
  const doc = markdownToRichText(
    "# 0042. Use a queue\n\n## Status\n\nSuperseded by [0050](0050-x.md).\nRecorded against `abc`.\n\n## Context\n\n- why",
  );

  it("takes a leading H1 as the title", () => {
    const { title, doc: body } = takeTitle(doc);
    expect(title).toBe("0042. Use a queue");
    expect(body.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
    expect(takeTitle(markdownToRichText("Text first\n\n# Late")).title).toBeNull();
  });

  it("reads a section's text, which parses as an ADR status", () => {
    const status = sectionText(doc, "Status");
    expect(status).toBe("Superseded by 0050. Recorded against abc.");
    expect(parseAdrStatus(status ?? "")).toEqual({ status: "superseded", supersededBy: 50 });
    expect(sectionText(doc, "Missing")).toBeNull();
  });

  it.each([
    ["Accepted (recorded retrospectively).", "accepted_retrospective"],
    ["Accepted.", "accepted"],
    ["`Superseded by [0003](0003-a.md)`", "superseded"],
  ])("parses the status section %j", (text, status) => {
    const parsed = parseAdrStatus(
      sectionText(markdownToRichText(`## Status\n\n${text}\n`), "Status") ?? "",
    );
    expect(parsed?.status).toBe(status);
  });
});

describe("markdownToRichText: shapes the export writes (DOC-12 symmetry)", () => {
  it("reads `> **Note:**` / `> **Warning:**` blockquotes as callouts", () => {
    expect(
      blocks("> **Note:** Mind the gap.\n>\n> - x\n\n> **Warning:**\n\n> **Note** stays"),
    ).toEqual([
      {
        type: "callout",
        attrs: { tone: "info" },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Mind the gap." }] },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
              },
            ],
          },
        ],
      },
      { type: "callout", attrs: { tone: "warning" }, content: [{ type: "paragraph" }] },
      {
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Note", marks: [{ type: "bold" }] },
              { type: "text", text: " stays" },
            ],
          },
        ],
      },
    ]);
  });

  it("drops the export's HQ-only-links comment line, and nothing else", () => {
    expect(blocks(`text\n\n${HQ_ONLY_LINKS_NOTE}\n`)).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "text" }] },
    ]);
    expect(blocks("<!-- other -->")).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "<!-- other -->" }] },
    ]);
  });

  it("strips exactly one space after a task box", () => {
    const [list] = blocks("- [ ]  two spaces\n- [x]&#32;\n");
    expect(list?.content).toEqual([
      {
        type: "taskItem",
        attrs: { checked: false },
        content: [{ type: "paragraph", content: [{ type: "text", text: " two spaces" }] }],
      },
      { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph" }] },
    ]);
  });

  it("parses one inline run or table cell like the importer does", () => {
    expect(markdownInlineToNodes("a **b**")).toEqual([
      { type: "text", text: "a " },
      { type: "text", text: "b", marks: [{ type: "bold" }] },
    ]);
    expect(markdownCellToNodes("`x\\|y` \\| z")).toEqual([
      { type: "text", text: "x|y", marks: [{ type: "code" }] },
      { type: "text", text: " | z" },
    ]);
  });
});
