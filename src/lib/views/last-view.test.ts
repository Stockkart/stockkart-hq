import { describe, expect, it } from "vitest";

import { LAST_VIEW_QUERY_MAX, cleanStoredQuery, lastViewKey, withStoredQuery } from "./last-view";

describe("remembered views (VW-5)", () => {
  it("keys the board and the backlog per project, and nothing else", () => {
    expect(lastViewKey("/STK/board")).toBe("hq.last-view:/STK/board");
    expect(lastViewKey("/STK/backlog")).toBe("hq.last-view:/STK/backlog");
    expect(lastViewKey("/OPS/board")).toBe("hq.last-view:/OPS/board");
    expect(lastViewKey("/STK/issues")).toBeNull();
    expect(lastViewKey("/STK/board/extra")).toBeNull();
    expect(lastViewKey("/stk/board")).toBeNull();
    expect(lastViewKey("/my-work")).toBeNull();
    expect(lastViewKey("/")).toBeNull();
  });

  it("adds the stored query to a plain link", () => {
    expect(withStoredQuery("/STK/backlog", "status=s1&group=epic")).toBe(
      "/STK/backlog?status=s1&group=epic",
    );
    expect(withStoredQuery("/STK/board", "?scope=all")).toBe("/STK/board?scope=all");
    expect(withStoredQuery("/STK/board", null)).toBe("/STK/board");
    expect(withStoredQuery("/STK/board", "")).toBe("/STK/board");
  });

  it("never overrides a link that already names its view", () => {
    expect(withStoredQuery("/STK/board?scope=all", "types=bug")).toBe("/STK/board?scope=all");
    expect(withStoredQuery("/STK/board#top", "types=bug")).toBe("/STK/board#top");
  });

  it("only puts a well-formed, bounded query back on the URL", () => {
    // Re-encoded: stored text cannot break out of the query string.
    expect(cleanStoredQuery("q=a b&x=<y>#frag")).toBe("q=a+b&x=%3Cy%3E%23frag");
    expect(cleanStoredQuery(`q=${"a".repeat(LAST_VIEW_QUERY_MAX)}`)).toBe("");
    expect(cleanStoredQuery(null)).toBe("");
  });
});
