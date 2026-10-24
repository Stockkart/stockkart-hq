import { describe, expect, it } from "vitest";

import { EMPTY_FILTERS } from "@/lib/issues/filters";

import {
  boardViewQuery,
  listDefaultFilters,
  type ListDefaultsContext,
  listFiltersQuery,
  listUsesDefaults,
  listViewOf,
  normaliseView,
  parseBoardViewParams,
  resolveBoardView,
  resolveDefaults,
  sameView,
  saveViewDefaultsInput,
  viewDefaultsOf,
} from "./view-defaults";

const TRIAGE = "11111111-1111-4111-8111-111111111111";
const TODO = "22222222-2222-4222-8222-222222222222";
const DONE = "33333333-3333-4333-8333-333333333333";
const GONE = "44444444-4444-4444-8444-444444444444";
const STATUS_IDS = [TRIAGE, TODO, DONE];
const NONE = { types: [], hidden: [] };

describe("view defaults: normalising (BRD-6 / VW-4)", () => {
  it("orders types canonically, keeps known statuses in workflow order", () => {
    expect(
      normaliseView({ types: ["bug", "epic"], hidden: [DONE, GONE, TRIAGE] }, STATUS_IDS),
    ).toEqual({ types: ["epic", "bug"], hidden: [TRIAGE, DONE] });
  });

  it("treats every type as no type filter and never hides every status", () => {
    const all = ["epic", "story", "task", "bug", "spike", "tech_debt", "subtask"] as const;
    expect(normaliseView({ types: all, hidden: STATUS_IDS }, STATUS_IDS)).toEqual(NONE);
  });

  it("resolves stored defaults (null types = all) and round-trips them for saving", () => {
    const view = resolveDefaults({ issueTypes: ["task"], hiddenStatusIds: [TRIAGE] }, STATUS_IDS);
    expect(view).toEqual({ types: ["task"], hidden: [TRIAGE] });
    expect(viewDefaultsOf(view)).toEqual({ issueTypes: ["task"], hiddenStatusIds: [TRIAGE] });
    expect(viewDefaultsOf(NONE)).toEqual({ issueTypes: null, hiddenStatusIds: [] });
    expect(
      sameView({ types: ["bug", "task"], hidden: [] }, { types: ["task", "bug"], hidden: [] }),
    ).toBe(true);
  });
});

describe("board URL params (BRD-6)", () => {
  const defaults = { issueTypes: ["task" as const, "bug" as const], hiddenStatusIds: [TRIAGE] };

  it("uses the project defaults when the URL has no view params", () => {
    const params = parseBoardViewParams({});
    expect(params).toEqual({ types: null, hidden: null });
    expect(resolveBoardView(params, defaults, STATUS_IDS)).toEqual({
      types: ["task", "bug"],
      hidden: [TRIAGE],
    });
  });

  it("uses explicit params over the defaults, ignoring unknown values", () => {
    const params = parseBoardViewParams(
      new URLSearchParams(`types=epic,nonsense,epic&hide=${DONE},not-a-uuid`),
    );
    expect(params).toEqual({ types: ["epic"], hidden: [DONE] });
    expect(resolveBoardView(params, defaults, STATUS_IDS)).toEqual({
      types: ["epic"],
      hidden: [DONE],
    });
  });

  it("reads types=all and hide=none as explicitly everything", () => {
    const params = parseBoardViewParams({ types: "all", hide: "none" });
    expect(params).toEqual({ types: [], hidden: [] });
    expect(resolveBoardView(params, defaults, STATUS_IDS)).toEqual(NONE);
    // Only one dimension given: the other keeps its default.
    expect(resolveBoardView(parseBoardViewParams({ types: "all" }), defaults, STATUS_IDS)).toEqual({
      types: [],
      hidden: [TRIAGE],
    });
  });

  it("shows every column when the URL would hide them all", () => {
    const hideAll = parseBoardViewParams({ hide: STATUS_IDS.join(",") });
    expect(resolveBoardView(hideAll, defaults, STATUS_IDS).hidden).toEqual([]);
  });

  it("writes only what differs from the defaults, with all/none for cleared dimensions", () => {
    const base = resolveDefaults(defaults, STATUS_IDS);
    expect(boardViewQuery(base, base, { scope: "all" }).toString()).toBe("scope=all");
    expect(boardViewQuery({ types: ["bug"], hidden: [TRIAGE] }, base).toString()).toBe("types=bug");
    expect(boardViewQuery(NONE, base).toString()).toBe("types=all&hide=none");
    expect(boardViewQuery({ types: [], hidden: [TODO, DONE] }, NONE).toString()).toBe(
      `hide=${TODO}%2C${DONE}`,
    );
  });
});

describe("issue list defaults (VW-4)", () => {
  const stored = { issueTypes: ["bug" as const], hiddenStatusIds: [DONE] };
  const context: ListDefaultsContext = {
    ...listDefaultFilters(stored, STATUS_IDS),
    statusIds: STATUS_IDS,
    canonical: true,
  };

  it("applies the defaults only without type/status params and without a saved view", () => {
    expect(listUsesDefaults({}, false)).toBe(true);
    expect(listUsesDefaults({ priority: "0", q: "x" }, false)).toBe(true);
    expect(listUsesDefaults({ type: "bug" }, false)).toBe(false);
    expect(listUsesDefaults({ status: TODO }, false)).toBe(false);
    expect(listUsesDefaults({ type: "all" }, false)).toBe(false);
    // A saved view's own filters win.
    expect(listUsesDefaults({}, true)).toBe(false);
  });

  it("turns the defaults into filter values: types, and the statuses not hidden", () => {
    expect(listDefaultFilters(stored, STATUS_IDS)).toEqual({
      types: ["bug"],
      statuses: [TRIAGE, TODO],
    });
    expect(listDefaultFilters({ issueTypes: null, hiddenStatusIds: [] }, STATUS_IDS)).toEqual({
      types: [],
      statuses: [],
    });
    expect(listViewOf({ types: ["bug"], statuses: [TRIAGE, TODO] }, STATUS_IDS)).toEqual({
      types: ["bug"],
      hidden: [DONE],
    });
  });

  it("leaves the defaults out of URLs, and writes type=all to drop them", () => {
    const atDefaults = { ...EMPTY_FILTERS, types: ["bug" as const], statuses: [TODO, TRIAGE] };
    expect(listFiltersQuery({ ...atDefaults, priorities: [0] }, context).toString()).toBe(
      "priority=0",
    );
    expect(listFiltersQuery(EMPTY_FILTERS, context, { sort: "key" }).toString()).toBe(
      "type=all&sort=key",
    );
    expect(listFiltersQuery({ ...EMPTY_FILTERS, types: ["task"] }, context).toString()).toBe(
      "type=task",
    );
    // No defaults to drop: the plain URL already shows everything.
    const none = { types: [], statuses: [], statusIds: STATUS_IDS, canonical: true };
    expect(listFiltersQuery(EMPTY_FILTERS, none).toString()).toBe("");
    // With a saved view open, every filter is written out (defaults never apply there).
    expect(listFiltersQuery(atDefaults, { ...context, canonical: false }).toString()).toBe(
      `type=bug&status=${TODO}%2C${TRIAGE}`,
    );
  });
});

describe("saveViewDefaultsInput", () => {
  it("needs a side, and stores no or every type as null", () => {
    expect(saveViewDefaultsInput.safeParse({ projectKey: "STK" }).success).toBe(false);
    const parsed = saveViewDefaultsInput.parse({
      projectKey: "STK",
      board: { issueTypes: ["bug", "epic", "bug"], hiddenStatusIds: [TODO, TODO] },
      list: { issueTypes: [], hiddenStatusIds: [] },
    });
    expect(parsed.board).toEqual({ issueTypes: ["epic", "bug"], hiddenStatusIds: [TODO] });
    expect(parsed.list).toEqual({ issueTypes: null, hiddenStatusIds: [] });
  });
});
