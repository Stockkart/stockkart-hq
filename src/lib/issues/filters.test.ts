import { describe, expect, it } from "vitest";

import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  filtersToSearchParams,
  hasActiveFilters,
  parseBacklogGroup,
  parseIssueFilters,
  parseIssueSort,
  TEXT_FILTER_MAX,
} from "./filters";

const A = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const B = "0f1e2d3c-4b5a-4968-8776-5544332211aa";

describe("issue filter params (VW-1, VW-2)", () => {
  it("parses every dimension from Next.js searchParams", () => {
    expect(
      parseIssueFilters({
        type: "bug,task",
        status: A,
        priority: ["0", "1"],
        assignee: `me,none,${B}`,
        component: B,
        label: `${A},${B}`,
        q: "  outbox   retries ",
      }),
    ).toEqual({
      types: ["bug", "task"],
      statuses: [A],
      priorities: [0, 1],
      assignees: ["me", "none", B],
      components: [B],
      labels: [A, B],
      text: "outbox retries",
    });
  });

  it("ignores invalid values and unknown params instead of failing", () => {
    expect(
      parseIssueFilters({
        type: "bug,feature,<script>",
        status: "not-a-uuid",
        priority: "0,4,-1,1.5,0x1,",
        assignee: "everyone",
        label: `${A},${A}`,
        nonsense: "1",
      }),
    ).toEqual({ ...EMPTY_FILTERS, types: ["bug"], priorities: [0], labels: [A] });
  });

  it("ignores an over-long text filter", () => {
    expect(parseIssueFilters({ q: "x".repeat(TEXT_FILTER_MAX + 1) }).text).toBe("");
    expect(parseIssueFilters({ q: "x".repeat(TEXT_FILTER_MAX) }).text).toHaveLength(
      TEXT_FILTER_MAX,
    );
  });

  it("reads URLSearchParams too and round-trips through the URL", () => {
    const filters = parseIssueFilters({ type: "spike", assignee: "none", q: "a&b=c" });
    const params = filtersToSearchParams(filters, { sort: "priority", dir: "asc", group: "" });
    expect(params.toString()).toBe("type=spike&assignee=none&q=a%26b%3Dc&sort=priority&dir=asc");
    expect(parseIssueFilters(new URLSearchParams(params.toString()))).toEqual(filters);
    expect(filtersToSearchParams(EMPTY_FILTERS).toString()).toBe("");
  });

  it("parses sort and group with safe fallbacks", () => {
    expect(parseIssueSort({ sort: "priority", dir: "desc" })).toEqual({
      by: "priority",
      dir: "desc",
    });
    expect(parseIssueSort({ sort: "priority", dir: "sideways" })).toEqual({
      by: "priority",
      dir: "asc",
    });
    expect(parseIssueSort({ sort: "drop table" })).toEqual(DEFAULT_SORT);
    expect(parseBacklogGroup({ group: "epic" })).toBe("epic");
    expect(parseBacklogGroup({ group: ["assignee", "epic"] })).toBe("assignee");
    expect(parseBacklogGroup({ group: "sprint" })).toBe("none");
  });

  it("knows when any filter is active", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, assignees: ["me"] })).toBe(true);
  });
});
