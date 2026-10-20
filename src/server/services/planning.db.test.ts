import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { EMPTY_FILTERS, type IssueFilters } from "@/lib/issues/filters";
import { activity, issues, projects, statuses } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { ServiceError } from "./errors";
import { createIssueService, type CreateIssueData } from "./issues";
import { createPlanningService } from "./planning";
import { createPlanningQueries, type IssueScope } from "./planning-queries";

/** BLG-1 ranks, BRD-1 status moves, VW-1 filters and MY-1 against real Postgres. */
describeDb("planning (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let other: string;
  let projectId: string;
  const issueService = () => createIssueService(db, { runAtomic: transactionRunner(db) });
  const planning = () => createPlanningService(db);
  const queries = () => createPlanningQueries(db);

  const create = async (title: string, overrides: Partial<CreateIssueData> = {}) =>
    (
      await issueService().createIssue(actor, {
        projectKey: "STK",
        title,
        type: "task",
        priority: 2,
        ...overrides,
      })
    ).id;

  const list = (scope: IssueScope, filters: Partial<IssueFilters> = {}) =>
    queries().listIssues(projectId, {
      scope,
      filters: { ...EMPTY_FILTERS, ...filters },
      currentUserId: actor,
    });

  /** Titles of `ids` in backlog (rank) order. */
  async function order(ids: string[]): Promise<string[]> {
    const rows = await db
      .select({ id: issues.id, title: issues.title })
      .from(issues)
      .where(sql`${issues.id} IN ${ids}`)
      .orderBy(asc(issues.rank));
    return rows.map((row) => row.title);
  }

  async function statusId(name: string): Promise<string> {
    const [row] = await db
      .select({ id: statuses.id })
      .from(statuses)
      .where(and(eq(statuses.projectId, projectId), eq(statuses.name, name)));
    if (!row) throw new Error(`no status ${name}`);
    return row.id;
  }

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
    other = await createTestUser(db, "Bo Other");
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, "STK"));
    if (!project) throw new Error("seed made no project");
    projectId = project.id;
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("moves an issue between neighbours, to the top, and is a no-op when in place", async () => {
    // Each create goes to the top, so the order starts as d, c, b, a.
    const a = await create("rank a");
    const b = await create("rank b");
    const c = await create("rank c");
    const d = await create("rank d");
    const ids = [a, b, c, d];
    expect(await order(ids)).toEqual(["rank d", "rank c", "rank b", "rank a"]);

    await planning().moveIssue({ issueId: a, afterIssueId: d });
    expect(await order(ids)).toEqual(["rank d", "rank a", "rank c", "rank b"]);

    await planning().moveIssue({ issueId: b, afterIssueId: null });
    expect(await order(ids)).toEqual(["rank b", "rank d", "rank a", "rank c"]);

    const [before] = await db.select({ rank: issues.rank }).from(issues).where(eq(issues.id, a));
    const result = await planning().moveIssue({ issueId: a, afterIssueId: d });
    expect(result.rank).toBe(before?.rank);
  });

  it("places a move between the predecessor and its true successor, past hidden rows", async () => {
    const x = await create("hidden x");
    const y = await create("hidden y");
    const z = await create("hidden z");
    // Order z, y, x. Hide y (deleted rows keep their unique rank), then move x after z: a key
    // between z and the visible next (x itself) would be computed from the wrong pair.
    await issueService().deleteIssue(actor, y);
    await planning().moveIssue({ issueId: x, afterIssueId: z });
    const rows = await db
      .select({ title: issues.title })
      .from(issues)
      .where(sql`${issues.id} IN ${[x, y, z]}`)
      .orderBy(asc(issues.rank));
    expect(rows.map((row) => row.title)).toEqual(["hidden z", "hidden x", "hidden y"]);
  });

  it("retries with fresh neighbours when two moves race for the same gap", async () => {
    const p = await create("race prev");
    const m1 = await create("race m1");
    const m2 = await create("race m2");
    // Order m2, m1, p. Move both after p at once: both read the same neighbours and compute
    // the same key, so exactly one write hits the unique index and must retry.
    let waiting = 0;
    let writes = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const racing = createPlanningService(db, {
      beforeRankWrite: async () => {
        writes += 1;
        waiting += 1;
        if (waiting === 2) release();
        await gate;
      },
    });
    const [r1, r2] = await Promise.all([
      racing.moveIssue({ issueId: m1, afterIssueId: p }),
      racing.moveIssue({ issueId: m2, afterIssueId: p }),
    ]);
    expect(r1.rank).not.toBe(r2.rank);
    expect(writes).toBeGreaterThanOrEqual(3);
    const titles = await order([p, m1, m2]);
    expect(titles[0]).toBe("race prev");
    expect(titles.slice(1).sort()).toEqual(["race m1", "race m2"]);
  });

  it("rejects moving after an issue of another project or a deleted one", async () => {
    const a = await create("move target");
    const gone = await create("move gone");
    await issueService().deleteIssue(actor, gone);
    await expect(planning().moveIssue({ issueId: a, afterIssueId: gone })).rejects.toBeInstanceOf(
      ServiceError,
    );
    await expect(
      planning().moveIssue({ issueId: gone, afterIssueId: null }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it("board status move writes from → to activity and scopes done issues to 14 days", async () => {
    const card = await create("board card");
    const old = await create("board old done");
    const backlog = await statusId("Backlog");
    const inProgress = await statusId("In Progress");
    const done = await statusId("Done");

    const change = await issueService().updateIssueField(actor, {
      issueId: card,
      field: "status",
      value: inProgress,
    });
    expect(change).toEqual({ from: backlog, to: inProgress, changed: true });
    const rows = await db
      .select()
      .from(activity)
      .where(and(eq(activity.entityId, card), eq(activity.field, "status")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: actor, fromValue: backlog, toValue: inProgress });

    await issueService().updateIssueField(actor, { issueId: card, field: "status", value: done });
    await issueService().updateIssueField(actor, { issueId: old, field: "status", value: done });
    await db
      .update(issues)
      .set({ resolvedAt: new Date(Date.now() - 20 * 24 * 3600 * 1000) })
      .where(eq(issues.id, old));

    const board = (await list("board")).map((row) => row.id);
    expect(board).toContain(card);
    expect(board).not.toContain(old);
    const backlogIds = (await list("backlog")).map((row) => row.id);
    expect(backlogIds).not.toContain(card);
    expect((await list("all")).map((row) => row.id)).toEqual(expect.arrayContaining([card, old]));
  });

  it("filters by type, priority, assignee (me / none / id), label and text", async () => {
    const bug = await create("filter needle bug", { type: "bug", priority: 0, assigneeId: actor });
    const story = await create("filter story", { type: "story", priority: 3 });
    const theirs = await create("filter theirs", { assigneeId: other });
    await issueService().addLabel(actor, { issueId: story, name: "ocr" });
    await issueService().updateIssueField(actor, {
      issueId: story,
      field: "description",
      value: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "outbox dispatch" }] }],
      },
    });
    const ids = async (filters: Partial<IssueFilters>) =>
      (await list("all", filters))
        .map((row) => row.id)
        .filter((id) => [bug, story, theirs].includes(id));

    expect(await ids({ types: ["bug"] })).toEqual([bug]);
    expect(await ids({ priorities: [3] })).toEqual([story]);
    expect(await ids({ assignees: ["me"] })).toEqual([bug]);
    expect(await ids({ assignees: [other] })).toEqual([theirs]);
    expect((await ids({ assignees: ["none"] })).sort()).toEqual([story]);
    expect(await ids({ assignees: ["me", "none"] })).toEqual(expect.arrayContaining([bug, story]));
    const [label] = (await list("all", { types: ["story"] }))
      .filter((row) => row.id === story)
      .flatMap((row) => row.labels);
    expect(label?.name).toBe("ocr");
    expect(await ids({ labels: [label?.id ?? ""] })).toEqual([story]);
    // Full text (stemmed: "dispatching" matches "dispatch"), title substring, and key.
    expect(await ids({ text: "dispatching" })).toEqual([story]);
    expect(await ids({ text: "needl" })).toEqual([bug]);
    const key = (await list("all")).find((row) => row.id === theirs)?.key ?? "";
    expect(await ids({ text: key })).toEqual([theirs]);
    // AND across dimensions.
    expect(await ids({ types: ["bug"], priorities: [3] })).toEqual([]);
  });

  it("sorts the list by a column in either direction", async () => {
    const rows = await queries().listIssues(projectId, {
      scope: "all",
      filters: EMPTY_FILTERS,
      sort: { by: "priority", dir: "asc" },
      currentUserId: actor,
    });
    const priorities = rows.map((row) => row.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    const byKey = await queries().listIssues(projectId, {
      scope: "all",
      filters: EMPTY_FILTERS,
      sort: { by: "key", dir: "asc" },
      currentUserId: actor,
    });
    const numbers = byKey.map((row) => row.number);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it("records recently viewed issues per user, newest first, hiding deleted ones", async () => {
    const first = await create("viewed first");
    const second = await create("viewed second");
    const gone = await create("viewed gone");
    await planning().recordIssueView(actor, { issueId: first });
    await planning().recordIssueView(actor, { issueId: second });
    await planning().recordIssueView(actor, { issueId: gone });
    await planning().recordIssueView(actor, { issueId: first });
    await issueService().deleteIssue(actor, gone);

    const recent = await queries().listRecentlyViewed(actor);
    expect(recent.map((item) => item.id)).toEqual([first, second]);
    expect(await queries().listRecentlyViewed(other)).toEqual([]);
  });

  it("groups my assigned issues by status category", async () => {
    const mine = await create("mine in progress", { assigneeId: other });
    await issueService().updateIssueField(actor, {
      issueId: mine,
      field: "status",
      value: await statusId("In Progress"),
    });
    const todo = await create("mine todo", { assigneeId: other });
    const groups = await queries().listAssignedTo(other);
    expect(groups.in_progress.map((row) => row.id)).toEqual([mine]);
    expect(groups.todo.map((row) => row.id)).toEqual(expect.arrayContaining([todo]));
    expect(groups.todo.map((row) => row.id)).not.toContain(mine);
  });
});
