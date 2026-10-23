import { describe, expect, it } from "vitest";

import { rt } from "@/lib/rich-text";

import { createDocCommentInput, resolveDocThreadInput } from "./schemas";

const DOC = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const PARENT = "11111111-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const body = rt.doc(rt.paragraph("Looks good"));

describe("doc comment inputs (DOC-11, DOC-13)", () => {
  it("accepts a page-level comment, an anchored one and a reply", () => {
    expect(createDocCommentInput.safeParse({ docId: DOC, body }).success).toBe(true);
    const anchored = createDocCommentInput.parse({
      docId: DOC,
      body,
      anchor: { id: "Ab3_-xYz0123", text: "  the\nquoted   text " },
    });
    expect(anchored.anchor).toEqual({ id: "Ab3_-xYz0123", text: "the quoted text" });
    expect(createDocCommentInput.safeParse({ docId: DOC, body, parentId: PARENT }).success).toBe(
      true,
    );
  });

  it.each([
    ["an id with spaces", "not valid"],
    ["an empty id", ""],
    ["a 65-character id", "a".repeat(65)],
  ])("refuses an anchor with %s", (_label, id) => {
    expect(
      createDocCommentInput.safeParse({ docId: DOC, body, anchor: { id, text: "x" } }).success,
    ).toBe(false);
  });

  it("cuts the quote to 500 characters and stores a blank one as null", () => {
    const long = createDocCommentInput.parse({
      docId: DOC,
      body,
      anchor: { id: "abc", text: "x".repeat(900) },
    });
    expect(long.anchor?.text).toHaveLength(500);
    const blank = createDocCommentInput.parse({
      docId: DOC,
      body,
      anchor: { id: "abc", text: " " },
    });
    expect(blank.anchor?.text).toBeNull();
  });

  it("refuses a reply with an anchor (replies belong to their thread) and empty bodies", () => {
    const reply = createDocCommentInput.safeParse({
      docId: DOC,
      body,
      parentId: PARENT,
      anchor: { id: "abc", text: "x" },
    });
    expect(reply.success).toBe(false);
    expect(
      createDocCommentInput.safeParse({ docId: DOC, body: rt.doc(rt.paragraph()) }).success,
    ).toBe(false);
  });

  it("validates resolve/reopen", () => {
    expect(resolveDocThreadInput.safeParse({ commentId: PARENT, resolved: false }).success).toBe(
      true,
    );
    expect(resolveDocThreadInput.safeParse({ commentId: "x", resolved: true }).success).toBe(false);
  });
});
