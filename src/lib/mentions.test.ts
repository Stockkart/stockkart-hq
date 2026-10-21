import { describe, expect, it } from "vitest";

import { extractUserMentionIds } from "./mentions";

const BOB = "BBBBBBBB-0000-4000-8000-000000000002";
const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";

describe("extractUserMentionIds (ISS-7, DOC-9)", () => {
  it("returns unique, lower-cased ids in document order, ignoring bad ids", () => {
    expect(
      extractUserMentionIds({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "mention", attrs: { id: BOB, label: "Bob" } }] },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "mention", attrs: { id: ALICE } },
                      { type: "mention", attrs: { id: BOB.toLowerCase() } },
                      { type: "mention", attrs: { id: "<script>" } },
                      { type: "mention", attrs: { id: 7 } },
                      { type: "text", text: "@Carol" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual([BOB.toLowerCase(), ALICE]);
  });

  it("handles empty input", () => {
    expect(extractUserMentionIds(null)).toEqual([]);
    expect(extractUserMentionIds({ type: "doc" })).toEqual([]);
  });
});
