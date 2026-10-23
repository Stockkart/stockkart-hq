import { describe, expect, it } from "vitest";

import { type DocThreadView } from "@/lib/doc-comments/views";
import { rt } from "@/lib/rich-text";

import { applyThreadUpdate, highlightCss, threadOfComment } from "./thread-state";

const thread = (id: string, replies: string[] = []): DocThreadView => ({
  id,
  authorId: "u1",
  authorName: "Ada",
  body: rt.doc(rt.paragraph(id)),
  createdAt: new Date(0),
  editedAt: null,
  anchorId: null,
  anchorText: null,
  resolvedAt: null,
  resolvedByName: null,
  replies: replies.map((reply) => ({
    id: reply,
    authorId: "u2",
    authorName: "Bo",
    body: rt.doc(rt.paragraph(reply)),
    createdAt: new Date(0),
    editedAt: null,
  })),
});

describe("comments panel state", () => {
  it("applies optimistic updates (add, reply, resolve, edit, delete)", () => {
    let threads = [thread("t1"), thread("t2", ["r1"])];
    threads = applyThreadUpdate(threads, { kind: "addThread", thread: thread("t3") });
    threads = applyThreadUpdate(threads, {
      kind: "addReply",
      threadId: "t1",
      reply: { ...thread("r2"), authorId: "u2" },
    });
    threads = applyThreadUpdate(threads, {
      kind: "resolve",
      threadId: "t3",
      resolvedAt: new Date(5),
      resolvedByName: "Ada",
    });
    threads = applyThreadUpdate(threads, {
      kind: "edit",
      commentId: "r1",
      body: rt.doc(rt.paragraph("edited")),
    });
    expect(threads.map((item) => item.id)).toEqual(["t1", "t2", "t3"]);
    expect(threads[0]?.replies.map((reply) => reply.id)).toEqual(["r2"]);
    expect(threads[2]?.resolvedAt).toEqual(new Date(5));
    expect(threads[1]?.replies[0]?.body).toEqual(rt.doc(rt.paragraph("edited")));
    expect(threadOfComment(threads, "r1")?.id).toBe("t2");

    // Deleting a top comment with replies leaves a placeholder; without, it disappears.
    const deleted = applyThreadUpdate(
      applyThreadUpdate(threads, { kind: "delete", commentId: "t2" }),
      { kind: "delete", commentId: "t3" },
    );
    expect(deleted.map((item) => [item.id, item.body === null])).toEqual([
      ["t1", false],
      ["t2", true],
    ]);
    expect(applyThreadUpdate(deleted, { kind: "delete", commentId: "r2" })[0]?.replies).toEqual([]);
  });

  it("highlights open anchors with a background and an underline, the active one more", () => {
    const css = highlightCss(["abc", "abc", "x-Y_1"], "x-Y_1");
    expect(css).toContain('.rich-text [data-comment-anchor="abc"]');
    expect(css).toContain("text-decoration-line: underline");
    expect(css).toContain("background-color: var(--comment-highlight)");
    expect(css).toContain(
      '.rich-text [data-comment-anchor="x-Y_1"] {\n  background-color: var(--comment-highlight-active)',
    );
    expect(css.match(/data-comment-anchor="abc"/g)).toHaveLength(1);
  });

  it("never puts a malformed id into the CSS, and nothing at all without open anchors", () => {
    expect(highlightCss([], null)).toBe("");
    expect(highlightCss(['a"] { } body { x', "</style>"], null)).toBe("");
    expect(highlightCss(["ok"], 'a"]')).not.toContain('a"]');
  });
});
