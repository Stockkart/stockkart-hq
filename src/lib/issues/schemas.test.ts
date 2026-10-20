import { describe, expect, it } from "vitest";

import {
  RICH_TEXT_LIMITS,
  extractPlainText,
  richTextDocSchema,
  type RichTextNode,
} from "../rich-text";

import { addLabelInput, addLinkInput, createIssueInput, updateIssueFieldInput } from "./schemas";

const ID = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";

describe("createIssueInput", () => {
  it("needs only a title; type and priority default", () => {
    expect(createIssueInput.parse({ projectKey: "STK", title: "  Fix   the  thing " })).toEqual({
      projectKey: "STK",
      title: "Fix the thing",
      type: "task",
      priority: 2,
    });
  });

  it.each([
    [{ projectKey: "STK", title: "   " }, "Title is required"],
    [{ projectKey: "STK", title: "x".repeat(256) }, "Title is too long"],
    [{ projectKey: "stk", title: "x" }, ""],
    [{ projectKey: "STK", title: "x", type: "story-ish" }, ""],
    [{ projectKey: "STK", title: "x", priority: 4 }, ""],
    [{ projectKey: "STK", title: "x", priority: "1" }, ""],
    [{ projectKey: "STK", title: "x", parentId: "not-a-uuid" }, ""],
    [{ projectKey: "STK", title: "x", description: "<b>html</b>" }, ""],
  ])("rejects %j", (input, message) => {
    const result = createIssueInput.safeParse(input);
    expect(result.success).toBe(false);
    if (message) expect(result.error?.issues[0]?.message).toBe(message);
  });
});

describe("updateIssueFieldInput", () => {
  it("accepts one known field with a value of the right type", () => {
    expect(
      updateIssueFieldInput.parse({ issueId: ID, field: "dueDate", value: "2026-06-15" }),
    ).toEqual({ issueId: ID, field: "dueDate", value: "2026-06-15" });
    expect(updateIssueFieldInput.parse({ issueId: ID, field: "assignee", value: null })).toEqual({
      issueId: ID,
      field: "assignee",
      value: null,
    });
  });

  it.each([
    { issueId: ID, field: "resolvedAt", value: null },
    { issueId: ID, field: "reporter", value: ID },
    { issueId: ID, field: "status", value: null },
    { issueId: ID, field: "priority", value: -1 },
    { issueId: ID, field: "storyPoints", value: 2.5 },
    { issueId: ID, field: "storyPoints", value: 1000 },
    { issueId: ID, field: "dueDate", value: "15/06/2026" },
    { issueId: ID, field: "title", value: "" },
    { issueId: "1; DROP TABLE issues", field: "title", value: "x" },
  ])("rejects %j", (input) => {
    expect(updateIssueFieldInput.safeParse(input).success).toBe(false);
  });
});

describe("label and link inputs", () => {
  it("normalises label names and rejects odd ones", () => {
    expect(addLabelInput.parse({ issueId: ID, name: " Memory Leak " }).name).toBe("memory-leak");
    expect(addLabelInput.safeParse({ issueId: ID, name: "<script>" }).success).toBe(false);
    expect(addLabelInput.safeParse({ issueId: ID, name: "x".repeat(41) }).success).toBe(false);
  });

  it("only accepts the five link relations", () => {
    expect(
      addLinkInput.safeParse({ issueId: ID, relation: "blocks", targetKey: "STK-1" }).success,
    ).toBe(true);
    expect(
      addLinkInput.safeParse({ issueId: ID, relation: "owns", targetKey: "STK-1" }).success,
    ).toBe(false);
  });
});

describe("rich text documents", () => {
  const paragraph = (text: string): RichTextNode => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });

  it("accepts editor JSON and extracts one line per block", () => {
    const doc = richTextDocSchema.parse({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Steps" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [paragraph("one")] }] },
        paragraph("two"),
      ],
    });
    expect(extractPlainText(doc)).toBe("Steps\none\ntwo");
  });

  it("rejects non-doc roots and malformed nodes", () => {
    expect(richTextDocSchema.safeParse({ type: "paragraph" }).success).toBe(false);
    expect(richTextDocSchema.safeParse({ type: "doc", content: [{ text: "x" }] }).success).toBe(
      false,
    );
    expect(richTextDocSchema.safeParse("<p>hi</p>").success).toBe(false);
  });

  it("rejects documents nested deeper than the limit", () => {
    let node: RichTextNode = paragraph("deep");
    for (let i = 0; i < RICH_TEXT_LIMITS.maxDepth; i += 1) {
      node = { type: "blockquote", content: [node] };
    }
    expect(richTextDocSchema.safeParse({ type: "doc", content: [node] }).success).toBe(false);
  });
});
