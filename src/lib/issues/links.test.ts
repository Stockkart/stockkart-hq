import { describe, expect, it } from "vitest";

import { LINK_RELATIONS } from "./constants";
import { toStoredLink, viewLink } from "./links";

describe("issue links (ISS-6)", () => {
  it.each([
    ["blocks", "A", "B", "blocks", "is_blocked_by"],
    ["is_blocked_by", "B", "A", "blocks", "is_blocked_by"],
    ["duplicates", "A", "B", "duplicates", "is_duplicated_by"],
    ["is_duplicated_by", "B", "A", "duplicates", "is_duplicated_by"],
    ["relates", "A", "B", "relates", "relates"],
  ] as const)(
    "'A %s B' stores %s→%s and reads back from both ends",
    (relation, source, target, sourceView, targetView) => {
      const stored = toStoredLink(relation, "A", "B");
      expect([stored.sourceIssueId, stored.targetIssueId]).toEqual([source, target]);
      expect(viewLink(stored, source)).toEqual({ relation: sourceView, otherIssueId: target });
      expect(viewLink(stored, target)).toEqual({ relation: targetView, otherIssueId: source });
    },
  );

  it.each(LINK_RELATIONS)("'%s' reads as itself from the issue it was added on", (relation) => {
    expect(viewLink(toStoredLink(relation, "A", "B"), "A")).toEqual({
      relation,
      otherIssueId: "B",
    });
  });
});
