import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withoutPendingUploads } from "@/lib/attachments/nodes";
import { anchorIdsInOrder, COMMENT_ANCHOR_MARK } from "@/lib/doc-comments/anchors";
import { saveDocInput } from "@/lib/docs/schemas";
import { type RichTextDoc } from "@/lib/rich-text";

import { AUTOSAVE_DELAY_MS, DocAutosaver, type SaveRequest, type SaveResponse } from "../autosaver";

/** DOC-13: comment marks are plain JSON, so autosave and §7.4 conflicts keep them. */

const marked = (text: string, anchorId: string): RichTextDoc => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "before " },
        { type: "text", text, marks: [{ type: COMMENT_ANCHOR_MARK, attrs: { anchorId } }] },
      ],
    },
  ],
});

describe("comment marks through autosave and conflicts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("survives the save input schema and the upload-placeholder strip", () => {
    const content = marked("quoted", "anchor1");
    const parsed = saveDocInput.parse({ docId: crypto.randomUUID(), baseVersion: 1, content });
    expect(parsed.content).toEqual(content);
    expect(withoutPendingUploads(content)).toEqual(content);
  });

  it("is sent with the autosave, and re-sent by Keep mine after a conflict", async () => {
    const requests: SaveRequest[] = [];
    const responses: ((request: SaveRequest) => SaveResponse)[] = [
      () => ({
        status: "conflict",
        latest: { version: 6, title: "T", content: marked("theirs", "other"), updatedByName: "Bo" },
      }),
      () => ({ status: "saved", version: 7 }),
    ];
    const saver = new DocAutosaver(
      { version: 5, content: marked("start", "anchor1"), title: "T" },
      {
        save: async (request) => {
          requests.push(request);
          const next = responses.shift();
          if (!next) throw new Error("unexpected save");
          return next(request);
        },
        onState: () => undefined,
      },
    );
    const mine = marked("mine", "anchor2");
    saver.change({ content: mine });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saver.current.status).toBe("conflict");
    // The winner's copy (Reload) carries its own marks.
    expect(anchorIdsInOrder(saver.current.conflict?.content)).toEqual(["other"]);

    saver.keepMine();
    await vi.advanceTimersByTimeAsync(0);
    expect(
      requests.map((request) => [request.baseVersion, anchorIdsInOrder(request.content)]),
    ).toEqual([
      [5, ["anchor2"]],
      [6, ["anchor2"]],
    ]);
    expect(saver.current).toMatchObject({ status: "saved", version: 7 });
  });

  it("Reload takes the winner's copy with its marks", async () => {
    const saver = new DocAutosaver(
      { version: 1, content: marked("start", "a1"), title: "T" },
      {
        save: async () => ({
          status: "conflict",
          latest: { version: 2, title: "T", content: marked("x", "theirs"), updatedByName: null },
        }),
        onState: () => undefined,
      },
    );
    saver.change({ content: marked("mine", "a1") });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    const latest = saver.reload();
    expect(anchorIdsInOrder(latest?.content)).toEqual(["theirs"]);
    expect(anchorIdsInOrder(saver.mine.content)).toEqual(["theirs"]);
  });
});
