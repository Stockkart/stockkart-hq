import { describe, expect, it } from "vitest";

import { type ActivityView } from "@/lib/issues/views";

import { type ActivityLookups, describeActivity } from "./activity-format";

const lookups: ActivityLookups = {
  statuses: new Map([
    ["s-todo", "Todo"],
    ["s-done", "Done"],
  ]),
  users: new Map([["u-1", "Ada"]]),
  components: new Map(),
  issueKeys: { "i-5": "STK-5" },
};

const entry = (overrides: Partial<ActivityView>): ActivityView => ({
  id: "a",
  actorName: "Ada",
  action: "updated",
  field: null,
  fromValue: null,
  toValue: null,
  meta: null,
  createdAt: new Date(0),
  ...overrides,
});

describe("describeActivity (ISS-8)", () => {
  it("resolves ids to names for from → to", () => {
    expect(
      describeActivity(entry({ field: "status", fromValue: "s-todo", toValue: "s-done" }), lookups),
    ).toEqual({ verb: "changed status", from: "Todo", to: "Done" });
    expect(
      describeActivity(entry({ field: "priority", fromValue: "2", toValue: "0" }), lookups),
    ).toEqual({ verb: "changed priority", from: "P2 Medium", to: "P0 Critical" });
    expect(describeActivity(entry({ field: "assignee", toValue: "u-1" }), lookups)).toEqual({
      verb: "changed assignee",
      from: "none",
      to: "Ada",
    });
  });

  it("words links from this issue's viewpoint", () => {
    expect(
      describeActivity(
        entry({ action: "link_added", toValue: "i-5", meta: { relation: "is_blocked_by" } }),
        lookups,
      ),
    ).toEqual({ verb: "added link", from: null, to: "is blocked by STK-5" });
  });

  it("copes with deleted references and odd meta", () => {
    expect(
      describeActivity(entry({ field: "parent", fromValue: "gone", toValue: "i-5" }), lookups),
    ).toEqual({ verb: "changed parent", from: "a deleted issue", to: "STK-5" });
    expect(describeActivity(entry({ action: "label_added", meta: { name: 42 } }), lookups)).toEqual(
      { verb: "added label", from: null, to: null },
    );
  });
});
