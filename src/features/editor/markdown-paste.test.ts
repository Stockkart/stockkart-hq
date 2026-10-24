// @vitest-environment jsdom
import { Editor, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import {
  fitToSchema,
  looksLikeMarkdown,
  MarkdownPaste,
  markdownPasteContent,
} from "./markdown-paste";

const basicSchema = getSchema([StarterKit]);

describe("looksLikeMarkdown", () => {
  it.each([
    "# Title",
    "## Section\nSome text",
    "- one\n- two",
    "1. first\n2. second",
    "> quoted",
    "```ts\nconst a = 1;\n```",
    "| a | b |\n| --- | --- |\n| 1 | 2 |",
    "This is **bold** text",
    "Use `pnpm test` here",
    "See [docs](https://example.com)",
    "---",
  ])("detects %j", (text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "Just a normal sentence.",
    "Two lines\nof plain prose",
    "price is 5 * 3 = 15",
    "email me at a@b.com",
  ])("leaves plain text alone: %j", (text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });
});

describe("markdownPasteContent", () => {
  it("keeps a single paragraph inline so it joins the current line", () => {
    expect(markdownPasteContent("This is **bold**", basicSchema)).toEqual([
      { type: "text", text: "This is " },
      { type: "text", text: "bold", marks: [{ type: "bold" }] },
    ]);
  });

  it("returns blocks for headings and lists", () => {
    const content = markdownPasteContent("# Title\n\n- a\n- b", basicSchema);
    expect(content.map((node) => node.type)).toEqual(["heading", "bulletList"]);
  });

  it("fits nodes the editor doesn't have (no tables or Mermaid in issue editors)", () => {
    const content = markdownPasteContent(
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```mermaid\ngraph TD; A-->B\n```",
      basicSchema,
    );
    expect(content.every((node) => basicSchema.nodes[node.type] !== undefined)).toBe(true);
    expect(content.at(-1)).toEqual({
      type: "codeBlock",
      attrs: { language: null },
      content: [{ type: "text", text: "graph TD; A-->B" }],
    });
  });

  it("drops marks the schema doesn't know", () => {
    const fitted = fitToSchema(
      [{ type: "text", text: "x", marks: [{ type: "bold" }, { type: "unknownMark" }] }],
      basicSchema,
    );
    expect(fitted).toEqual([{ type: "text", text: "x", marks: [{ type: "bold" }] }]);
  });
});

describe("MarkdownPaste in an editor", () => {
  let editor: Editor | null = null;
  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function paste(
    target: Editor,
    data: Record<string, string>,
    options: { files?: number } = {},
  ): boolean {
    const event = {
      clipboardData: {
        types: Object.keys(data),
        files: { length: options.files ?? 0 },
        getData: (type: string) => data[type] ?? "",
      },
      preventDefault: () => undefined,
    } as unknown as ClipboardEvent;
    let handled = false;
    target.view.someProp("handlePaste", (handler) => {
      handled ||= handler(target.view, event, target.state.doc.slice(0)) === true;
      return handled || undefined;
    });
    return handled;
  }

  function create() {
    editor = new Editor({ extensions: [StarterKit, MarkdownPaste], content: "<p></p>" });
    // The cursor in the empty first paragraph, as when someone clicks into a new doc.
    editor.commands.setTextSelection(1);
    return editor;
  }

  it("formats pasted Markdown text", () => {
    const target = create();
    expect(paste(target, { "text/plain": "# Plan\n\n- **ship** it\n- test it" })).toBe(true);
    // The empty paragraph is replaced (StarterKit's trailing-node keeps one paragraph last).
    expect(target.getJSON().content?.map((node) => node.type)).toEqual([
      "heading",
      "bulletList",
      "paragraph",
    ]);
    expect(target.getText()).toContain("ship it");
  });

  it("leaves HTML pastes, file pastes and plain prose to the editor", () => {
    const target = create();
    expect(paste(target, { "text/html": "<b>x</b>", "text/plain": "**x**" })).toBe(false);
    expect(paste(target, { "text/plain": "# x" }, { files: 1 })).toBe(false);
    expect(paste(target, { "text/plain": "plain words" })).toBe(false);
  });

  it("treats a VS Code copy (HTML plus vscode-editor-data) as Markdown", () => {
    const target = create();
    expect(
      paste(target, {
        "text/plain": "## Heading",
        "text/html": "<div><span>## Heading</span></div>",
        "vscode-editor-data": "{}",
      }),
    ).toBe(true);
  });

  it("pastes raw text after ⌘/Ctrl+Shift+V", () => {
    const target = create();
    target.view.someProp("handleKeyDown", (handler) =>
      handler(
        target.view,
        new KeyboardEvent("keydown", { key: "V", shiftKey: true, ctrlKey: true }),
      ),
    );
    expect(paste(target, { "text/plain": "# not a heading" })).toBe(false);
    // Only that one paste: the next is formatted again.
    expect(paste(target, { "text/plain": "# heading" })).toBe(true);
  });

  it("does not convert inside a code block", () => {
    editor = new Editor({
      extensions: [StarterKit, MarkdownPaste],
      content: "<pre><code>x</code></pre>",
    });
    editor.commands.setTextSelection(2);
    expect(paste(editor, { "text/plain": "# inside code" })).toBe(false);
  });
});
