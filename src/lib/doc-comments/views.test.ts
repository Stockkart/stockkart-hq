import { describe, expect, it } from "vitest";

import { rt } from "@/lib/rich-text";

import { type DocCommentRow, groupThreads, isOrphaned, threadSections } from "./views";

let clock = 0;
const row = (overrides: Partial<DocCommentRow> & { id: string }): DocCommentRow => ({
  parentId: null,
  authorId: "u1",
  authorName: "Ada",
  body: rt.doc(rt.paragraph(overrides.id)),
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, (clock += 1))),
  editedAt: null,
  anchorId: null,
  anchorText: null,
  resolvedAt: null,
  resolvedByName: null,
  deleted: false,
  ...overrides,
});

describe("doc comment threads (DOC-11, DOC-13)", () => {
  it("groups replies under their thread and keeps a deleted top only while it has replies", () => {
    const threads = groupThreads([
      row({ id: "t1" }),
      row({ id: "t2", deleted: true, body: null }),
      row({ id: "t3", deleted: true, body: null }),
      row({ id: "r1", parentId: "t1" }),
      row({ id: "r2", parentId: "t3" }),
      row({ id: "r3", parentId: "t3", deleted: true, body: null }),
      row({ id: "r4", parentId: "missing" }),
    ]);
    expect(threads.map((thread) => [thread.id, thread.replies.map((reply) => reply.id)])).toEqual([
      ["t1", ["r1"]],
      ["t3", ["r2"]],
    ]);
    expect(threads[1]?.body).toBeNull();
  });

  it("orders inline threads by anchor position, then orphans, page comments and resolved", () => {
    const threads = groupThreads([
      row({ id: "late", anchorId: "zzz", anchorText: "end" }),
      row({ id: "page" }),
      row({ id: "gone", anchorId: "old", anchorText: "removed words" }),
      row({ id: "early", anchorId: "aaa", anchorText: "start" }),
      row({ id: "done", anchorId: "aaa", resolvedAt: new Date(Date.UTC(2026, 0, 2)) }),
      row({ id: "done-later", resolvedAt: new Date(Date.UTC(2026, 0, 3)) }),
    ]);
    const order = ["aaa", "zzz"];
    const sections = threadSections(threads, order);
    const ids = (list: { id: string }[]) => list.map((thread) => thread.id);
    expect(ids(sections.anchored)).toEqual(["early", "late"]);
    expect(ids(sections.orphaned)).toEqual(["gone"]);
    expect(ids(sections.page)).toEqual(["page"]);
    // Resolved threads stay listed (most recently resolved first), orphaned or not.
    expect(ids(sections.resolved)).toEqual(["done-later", "done"]);
    const gone = threads.find((thread) => thread.id === "gone");
    expect(gone && isOrphaned(gone, order)).toBe(true);
    // Undo brings the text back: the thread is anchored again.
    expect(ids(threadSections(threads, ["old", ...order]).orphaned)).toEqual([]);
  });
});
