import { describe, expect, it } from "vitest";

import { extractPlainText, type RichTextMark, type RichTextNode, rt } from "@/lib/rich-text";

import {
  normalizeForMarkdown,
  printMarkdown,
  richTextToMarkdown,
  sortMarks,
} from "./from-rich-text";
import { HQ_ONLY_LINKS_NOTE, markdownToRichText } from "./to-rich-text";

/** Synthetic fixtures only (S-7): no handbook content is ever copied into the repo. */

const ID = "11111111-2222-4333-8444-555555555555";
const DIAGRAM = "66666666-7777-4888-9999-aaaaaaaaaaaa";

const text = (value: string, ...marks: (string | RichTextMark)[]): RichTextNode =>
  marks.length > 0
    ? {
        type: "text",
        text: value,
        marks: marks.map((mark) => (typeof mark === "string" ? { type: mark } : mark)),
      }
    : { type: "text", text: value };
const link = (href: string): RichTextMark => ({ type: "link", attrs: { href } });
const p = (...content: RichTextNode[]): RichTextNode => ({ type: "paragraph", content });
const doc = (...content: RichTextNode[]): RichTextNode => ({ type: "doc", content });
const item = (...content: RichTextNode[]): RichTextNode => ({ type: "listItem", content });
const task = (checked: boolean, ...content: RichTextNode[]): RichTextNode => ({
  type: "taskItem",
  attrs: { checked },
  content,
});
const cell = (type: "tableHeader" | "tableCell", ...content: RichTextNode[]): RichTextNode => ({
  type,
  content,
});
const row = (...content: RichTextNode[]): RichTextNode => ({ type: "tableRow", content });

const toMarkdown = (node: RichTextNode) => richTextToMarkdown(node, { projectKey: "STK" });

/** The round-trip property: import(export(doc)) is the doc as Markdown can hold it. */
function expectRoundTrip(node: RichTextNode) {
  const markdown = toMarkdown(node);
  expect(sortMarks(markdownToRichText(markdown))).toEqual(
    sortMarks(normalizeForMarkdown(node, { projectKey: "STK" })),
  );
  // Exporting the import again changes nothing (idempotent formatting).
  expect(toMarkdown(markdownToRichText(markdown))).toBe(markdown);
  return markdown;
}

const FIXTURES: Record<string, RichTextNode> = {
  headings: doc(
    { type: "heading", attrs: { level: 1 }, content: [text("One")] },
    { type: "heading", attrs: { level: 2 }, content: [text("Two "), text("bold", "bold")] },
    { type: "heading", attrs: { level: 3 }, content: [text("C# and #tags #")] },
    { type: "heading", attrs: { level: 2 } },
  ),
  marks: doc(
    p(
      text("plain "),
      text("bold", "bold"),
      text(" "),
      text("italic", "italic"),
      text(" "),
      text("gone", "strike"),
      text(" "),
      text("a `tick`", "code"),
      text(" "),
      text("both", "bold", "italic"),
      text(" and "),
      text("bold ", "bold"),
      text("then italic", "bold", "italic"),
      text(" end"),
    ),
  ),
  links: doc(
    p(
      text("see "),
      text("the docs", link("https://example.test/a b?q=(1)")),
      text(", "),
      text("code link", "code", link("other.md")),
      text(", "),
      text("bold link", "bold", link("mailto:someone@example.test")),
      text(" and "),
      text("bad", link("javascript:alert(1)")),
    ),
  ),
  lists: doc(
    {
      type: "bulletList",
      content: [
        item(p(text("one")), {
          type: "bulletList",
          content: [
            item(p(text("nested")), { type: "orderedList", content: [item(p(text("deep")))] }),
          ],
        }),
        item(p(text("two")), p(text("second paragraph"))),
        item(),
      ],
    },
    {
      type: "bulletList",
      content: [item(p(text("a list right after a list")))],
    },
    {
      type: "orderedList",
      attrs: { start: 9 },
      content: [
        item(p(text("nine"))),
        item(p(text("ten")), {
          type: "codeBlock",
          attrs: { language: "sh" },
          content: [text("echo hi")],
        }),
      ],
    },
    { type: "orderedList", content: [item(p(text("one again")))] },
  ),
  tasks: doc({
    type: "taskList",
    content: [
      task(false, p(text("todo"))),
      task(true, p(text("done", "bold"), text(" item")), {
        type: "taskList",
        content: [task(false, p(text("sub task")))],
      }),
      task(false, p()),
      task(false, p(text("  leading spaces"))),
    ],
  }),
  quotes: doc(
    { type: "blockquote", content: [p(text("quoted")), p(text("> twice"))] },
    { type: "callout", attrs: { tone: "info" }, content: [p(text("A note.")), rt.bullets("x")] },
    { type: "callout", attrs: { tone: "warning" }, content: [p(text("Careful", "bold"))] },
    { type: "callout", attrs: { tone: "info" }, content: [rt.bullets("list first")] },
    { type: "callout", attrs: { tone: "warning" }, content: [] },
  ),
  code: doc(
    {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [text("const a = 1;\n```\nnested fence")],
    },
    { type: "codeBlock", attrs: { language: "bad lang`" }, content: [text("x")] },
    { type: "codeBlock", attrs: { language: null } },
    { type: "codeBlock", attrs: { language: null }, content: [text("trailing\n")] },
    { type: "mermaid", attrs: { source: "graph TD\n  A-->B" } },
    { type: "mermaid", attrs: { source: "" } },
  ),
  table: doc({
    type: "table",
    content: [
      row(cell("tableHeader", p(text("Name"))), cell("tableHeader", p(text("Value | pipe")))),
      row(cell("tableCell", p(text("a"))), cell("tableCell", p(text("x|y", "code")))),
      row(cell("tableCell", p()), cell("tableCell", p(text("two")), p(text("paragraphs")))),
      row(cell("tableCell", p(text("short row")))),
    ],
  }),
  rulesAndBreaks: doc(
    p(
      text("line one"),
      { type: "hardBreak" },
      text("- not a list"),
      { type: "hardBreak" },
      text("1. nor this"),
    ),
    { type: "horizontalRule" },
    p(text("after the rule"), { type: "hardBreak" }),
  ),
  hqNodes: doc(
    p(
      text("ping "),
      { type: "mention", attrs: { id: ID, label: "Asha Rao" } },
      text(" about STK-12 and "),
      { type: "fileAttachment", attrs: { attachmentId: ID, filename: "plan.pdf", size: 10 } },
      text(" "),
      text("anchored", { type: "commentAnchor", attrs: { anchorId: "a1" } }),
    ),
    { type: "image", attrs: { attachmentId: ID, alt: "Screenshot", width: 10, height: 10 } },
    {
      type: "diagramEmbed",
      attrs: { diagramId: DIAGRAM, title: "Upload flow", projectKey: "STK", kind: "flow" },
    },
    { type: "attachmentUpload", attrs: { id: "x" } },
  ),
  escaping: doc(
    p(text("# not a heading")),
    p(text("- not a bullet + * _ ` [x] <b> | ~~ \\ &amp; &copy; 2 > 1")),
    p(text("1) not ordered")),
    p(text("snake_case_name and _under_ and *star*")),
    p(text("    four spaces would be code")),
    p(text("trailing spaces   ")),
    p(text("===")),
    p(text("---")),
    p(text("Wow!"), text("link", link("https://example.test"))),
    p(text("```")),
    p(text("[ref]: https://example.test")),
    // A pipe line followed by a delimiter-looking line must not become a table.
    p(text("a | b"), { type: "hardBreak" }, text(":-")),
    p(text("x `|` y"), { type: "hardBreak" }, text("-|-")),
    p(text("~single~ and $math$ and \u0000nul")),
  ),
};

describe("richTextToMarkdown (DOC-12)", () => {
  it.each(Object.entries(FIXTURES))("round-trips the %s fixture", (_name, fixture) => {
    const markdown = expectRoundTrip(fixture);
    expect(markdown.endsWith("\n")).toBe(true);
    expect(markdown.endsWith("\n\n")).toBe(false);
    // Deterministic: the same doc always prints the same bytes.
    expect(toMarkdown(fixture)).toBe(markdown);
  });

  it("prints headings, marks and links in GFM", () => {
    expect(toMarkdown(FIXTURES.headings ?? doc())).toBe(
      "# One\n\n## Two **bold**\n\n### C\\# and \\#tags \\#\n\n##\n",
    );
    expect(toMarkdown(FIXTURES.marks ?? doc())).toBe(
      "plain **bold** *italic* ~~gone~~ `` a `tick` `` ***both*** and **bold *then italic*** end\n",
    );
    expect(toMarkdown(FIXTURES.links ?? doc())).toBe(
      "see [the docs](https://example.test/a%20b?q=\\(1\\)), [`code link`](other.md), " +
        "[**bold link**](mailto:someone@example.test) and bad\n",
    );
  });

  it("prints lists, tasks, quotes and callouts", () => {
    expect(toMarkdown(FIXTURES.lists ?? doc())).toBe(
      [
        "- one\n  - nested\n    1. deep\n\n- two\n\n  second paragraph\n\n-",
        "* a list right after a list",
        "9. nine\n\n10. ten\n\n    ```sh\n    echo hi\n    ```",
        "1) one again",
      ].join("\n\n") + "\n",
    );
    expect(toMarkdown(FIXTURES.tasks ?? doc())).toBe(
      "- [ ] todo\n- [x] **done** item\n  - [ ] sub task\n- [ ]&#32;\n- [ ] &#32;&#32;leading spaces\n",
    );
    expect(toMarkdown(FIXTURES.quotes ?? doc())).toBe(
      [
        "> quoted\n>\n> \\> twice",
        "> **Note:** A note.\n>\n> - x",
        "> **Warning:** **Careful**",
        "> **Note:**\n>\n> - list first",
        "> **Warning:**",
      ].join("\n\n") + "\n",
    );
  });

  it("prints code fences, Mermaid, tables, rules and hard breaks", () => {
    expect(toMarkdown(FIXTURES.code ?? doc())).toBe(
      [
        "````ts\nconst a = 1;\n```\nnested fence\n````",
        "```\nx\n```",
        "```\n```",
        "```\ntrailing\n\n```",
        "```mermaid\ngraph TD\n  A-->B\n```",
        "```mermaid\n```",
      ].join("\n\n") + "\n",
    );
    expect(toMarkdown(FIXTURES.table ?? doc())).toBe(
      [
        "| Name | Value \\| pipe |",
        "| --- | --- |",
        "| a | `x\\|y` |",
        "|  | two paragraphs |",
        "| short row |  |",
      ].join("\n") + "\n",
    );
    expect(toMarkdown(FIXTURES.rulesAndBreaks ?? doc())).toBe(
      "line one\\\n\\- not a list\\\n1\\. nor this\n\n---\n\nafter the rule\n",
    );
  });

  it("writes HQ-only nodes as text and links, with one note that they need HQ", () => {
    expect(toMarkdown(FIXTURES.hqNodes ?? doc())).toBe(
      [
        "ping @Asha Rao about STK-12 and [plan.pdf](/api/files/" + ID + ") anchored",
        `[Screenshot](/api/files/${ID})`,
        `[Diagram: Upload flow](/STK/diagrams/${DIAGRAM})`,
        HQ_ONLY_LINKS_NOTE,
      ].join("\n\n") + "\n",
    );
    // Without a project key anywhere, a diagram embed keeps its title only.
    expect(
      richTextToMarkdown(doc({ type: "diagramEmbed", attrs: { diagramId: DIAGRAM, title: "T" } })),
    ).toBe("Diagram: T\n");
  });

  it("escapes text so it never becomes Markdown syntax", () => {
    const markdown = toMarkdown(FIXTURES.escaping ?? doc());
    expect(markdown).toContain("\\# not a heading");
    expect(markdown).toContain(
      "\\- not a bullet + \\* \\_ \\` \\[x\\] \\<b> \\| \\~\\~ \\\\ \\&amp; \\&copy; 2 > 1",
    );
    expect(markdown).toContain("snake_case_name and \\_under\\_ and \\*star\\*");
    expect(markdown).toContain("&#32;&#32;&#32;&#32;four spaces");
    expect(markdown).toContain("Wow\\![link](https://example.test)");
    // Every paragraph reads back as exactly its text (NUL reads as U+FFFD, as in markdown-it).
    const back = markdownToRichText(markdown);
    expect(extractPlainText(back)).toBe(
      extractPlainText(FIXTURES.escaping ?? doc()).replace(/\0/g, "\uFFFD"),
    );
  });

  it("is empty-safe and ends with exactly one newline", () => {
    expect(richTextToMarkdown(doc())).toBe("\n");
    expect(richTextToMarkdown(doc(p()))).toBe("\n");
    expect(printMarkdown({ type: "doc", content: [{ type: "paragraph" }] })).toBe("\n");
  });

  it("drops bold/italic that CommonMark could not read, but keeps the text", () => {
    const tricky = doc(p(text("x"), text('"q"', "bold"), text("y")));
    const markdown = expectRoundTrip(tricky);
    expect(extractPlainText(markdownToRichText(markdown))).toBe('x"q"y');
  });

  it("never lets text start a table, and escapes GitHub's single ~ and $ math", () => {
    expect(toMarkdown(doc(p(text("a | b"), { type: "hardBreak" }, text(":-"))))).toBe(
      "a \\| b\\\n\\:-\n",
    );
    expect(toMarkdown(doc(p(text("~x~ costs $5 or $x$"))))).toBe("\\~x\\~ costs \\$5 or \\$x\\$\n");
  });

  it("keeps ordered list numbers within CommonMark's nine digits", () => {
    const list = (start: number) =>
      doc({
        type: "orderedList",
        attrs: { start },
        content: [item(p(text("a"))), item(p(text("b")))],
      });
    expect(toMarkdown(list(999_999_998))).toBe("999999998. a\n999999999. b\n");
    expect(toMarkdown(list(999_999_999))).toBe("1. a\n2. b\n");
    expectRoundTrip(list(999_999_999));
  });

  it("notes HQ links of any kind, and keeps the note's text inside code", () => {
    expect(toMarkdown(doc(p(text("see"), text(" STK-1", link("/STK/issues/STK-1")))))).toContain(
      HQ_ONLY_LINKS_NOTE,
    );
    expect(toMarkdown(doc(p(text("x", link("https://example.test/STK")))))).toBe(
      "[x](https://example.test/STK)\n",
    );
    expectRoundTrip(
      doc({ type: "codeBlock", attrs: { language: null }, content: [text(HQ_ONLY_LINKS_NOTE)] }),
    );
  });

  it("is stable on Markdown written by hand (one pass normalises the formatting)", () => {
    const handWritten = [
      "# Title",
      "",
      "Some *emphasis* and __strong__ text,",
      "wrapped over two lines.",
      "",
      "* star bullet",
      "* [link](https://example.test)",
      "",
      "1) paren list",
      "",
      "> **Note:** a callout",
      "",
      "| a | b |",
      "|:--|--:|",
      "| 1 | 2 |",
      "",
      "~~~",
      "tilde fence",
      "~~~",
      "",
      "***",
      "",
    ].join("\n");
    const once = toMarkdown(markdownToRichText(handWritten));
    expect(toMarkdown(markdownToRichText(once))).toBe(once);
    expect(markdownToRichText(once)).toEqual(markdownToRichText(handWritten));
  });
});

/** Small deterministic PRNG (mulberry32), so the generated cases are the same on every run. */
function prng(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("richTextToMarkdown on generated inline content", () => {
  const ALPHABET = [
    "a",
    "b",
    "1",
    " ",
    " ",
    ".",
    "!",
    "*",
    "_",
    "`",
    "[",
    "]",
    "(",
    ")",
    "#",
    "-",
    "|",
    "~",
    "\\",
    "<",
    "&",
    ":",
    '"',
    "é",
  ];
  const MARKS = ["bold", "italic", "strike", "code"];

  it("keeps every character and reads back exactly as normalised (1500 cases)", () => {
    const random = prng(20_260_101);
    const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)] as T;
    for (let run = 0; run < 1500; run += 1) {
      const nodes: RichTextNode[] = [];
      const count = 1 + Math.floor(random() * 5);
      for (let index = 0; index < count; index += 1) {
        if (random() < 0.1) {
          nodes.push({ type: "hardBreak" });
          continue;
        }
        const length = 1 + Math.floor(random() * 4);
        const value = Array.from({ length }, () => pick(ALPHABET)).join("");
        const marks = MARKS.filter(() => random() < 0.3);
        if (random() < 0.15) marks.push("link");
        nodes.push(
          text(
            value,
            ...marks.map((mark) => (mark === "link" ? link("https://example.test/x") : mark)),
          ),
        );
      }
      const container = pick(["paragraph", "heading", "cell", "task", "item", "callout"]);
      const fixture =
        container === "paragraph"
          ? doc(p(...nodes), p(...nodes))
          : container === "heading"
            ? doc({ type: "heading", attrs: { level: 2 }, content: nodes })
            : container === "cell"
              ? doc({ type: "table", content: [row(cell("tableHeader", p(...nodes)))] })
              : container === "task"
                ? doc({ type: "taskList", content: [task(false, p(...nodes))] })
                : container === "item"
                  ? doc({ type: "orderedList", content: [item(p(...nodes)), item(p(...nodes))] })
                  : doc({ type: "callout", attrs: { tone: "info" }, content: [p(...nodes)] });
      const normalized = normalizeForMarkdown(fixture);
      const markdown = richTextToMarkdown(fixture);
      expect(sortMarks(markdownToRichText(markdown)), markdown).toEqual(sortMarks(normalized));
      expect(richTextToMarkdown(markdownToRichText(markdown))).toBe(markdown);
      // Only formatting may be lost, never characters (hard breaks read as spaces in
      // headings and cells; edge breaks of a paragraph are dropped).
      const flat = (node: RichTextNode) => extractPlainText(node).replace(/\s+/g, "");
      expect(flat(normalized)).toBe(flat(fixture));
    }
  });

  it("never turns lines of block-start characters into structure (1500 cases)", () => {
    const random = prng(7);
    const TOKENS = [
      "|",
      ":",
      "-",
      "---",
      ":-:",
      "a",
      " ",
      "1.",
      "2)",
      "#",
      ">",
      "=",
      "+",
      "*",
      "`",
      "~",
      "$",
      "[",
    ];
    const pick = () => TOKENS[Math.floor(random() * TOKENS.length)] ?? "a";
    for (let run = 0; run < 1500; run += 1) {
      const lineCount = 1 + Math.floor(random() * 4);
      const nodes: RichTextNode[] = [];
      for (let line = 0; line < lineCount; line += 1) {
        if (line > 0) nodes.push({ type: "hardBreak" });
        nodes.push(text(Array.from({ length: 1 + Math.floor(random() * 4) }, pick).join("")));
      }
      const container = Math.floor(random() * 3);
      const fixture =
        container === 0
          ? doc(p(...nodes))
          : container === 1
            ? doc({ type: "blockquote", content: [p(...nodes)] })
            : doc({ type: "bulletList", content: [item(p(...nodes))] });
      const markdown = richTextToMarkdown(fixture);
      expect(sortMarks(markdownToRichText(markdown)), markdown).toEqual(
        sortMarks(normalizeForMarkdown(fixture)),
      );
    }
  });
});
