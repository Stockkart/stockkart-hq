import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EMPTY_ROADMAP_FILTERS } from "@/lib/roadmap/filters";
import { epicProgress } from "@/lib/roadmap/progress";
import { createBatchedRead, type Read } from "@/server/db/read-batch";
import { activity, components, issues, projects, statuses } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";
import { appLayoutReads } from "@/test/page-reads";

import { ServiceError } from "./errors";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import { createRoadmapQueries } from "./roadmap-queries";
import { projectIdByKey } from "./sql";

/** RDM-1/RDM-2 against real Postgres (HQ_DB_TESTS=1). */
describeDb("roadmap (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let other: string;
  const service = () => createIssueService(db, { runAtomic: transactionRunner(db) });
  const roadmap = () => createRoadmapQueries(db);
  const stk = () => projectIdByKey("STK");

  const create = (type: "epic" | "story" | "task", title: string, parentId?: string) =>
    service().createIssue(actor, { projectKey: "STK", title, type, priority: 2, parentId });

  async function statusId(name: string): Promise<string> {
    const [row] = await db
      .select({ id: statuses.id })
      .from(statuses)
      .innerJoin(projects, eq(projects.id, statuses.projectId))
      .where(and(eq(projects.key, "STK"), eq(statuses.name, name)));
    if (!row) throw new Error(`no status ${name}`);
    return row.id;
  }

  const setStatus = async (issueId: string, name: string) =>
    service().updateIssueField(actor, { issueId, field: "status", value: await statusId(name) });
  const setPoints = (issueId: string, value: number | null) =>
    service().updateIssueField(actor, { issueId, field: "storyPoints", value });
  const schedule = (issueId: string, startDate: string | null, dueDate: string | null) =>
    service().updateIssueField(actor, {
      issueId,
      field: "schedule",
      value: { startDate, dueDate },
    });

  const epicOf = async (id: string, filters = EMPTY_ROADMAP_FILTERS, userId = actor) =>
    (await roadmap().listEpics(stk(), filters, userId)).find((epic) => epic.id === id);

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
    other = await createTestUser(db, "Bob Other");
  });

  afterAll(async () => {
    await testDb?.close();
  });

  describe("epic progress tallies", () => {
    it("sums live direct children, leaving Won't Do out of the points", async () => {
      const epic = await create("epic", "Payments");
      const done = await create("story", "Done story", epic.id);
      const open = await create("task", "Open task", epic.id);
      const dropped = await create("story", "Dropped", epic.id);
      const trashed = await create("task", "Trashed", epic.id);
      await setPoints(done.id, 5);
      await setPoints(open.id, 3);
      await setPoints(dropped.id, 8);
      await setPoints(trashed.id, 13);
      await setStatus(done.id, "Done");
      await setStatus(dropped.id, "Won't Do");
      await service().deleteIssue(actor, trashed.id);

      const row = await epicOf(epic.id);
      expect(row?.children).toEqual({
        total: 3,
        done: 1,
        wontDo: 1,
        points: 8,
        donePoints: 5,
        pointed: 2,
      });
      expect(row && epicProgress(row.children)).toEqual({
        percent: 62,
        basis: "points",
        label: "5 / 8 pts",
      });
    });

    it("counts children without points, and an epic with none", async () => {
      const epic = await create("epic", "Unestimated");
      const a = await create("task", "A", epic.id);
      await create("task", "B", epic.id);
      await setStatus(a.id, "Done");
      const row = await epicOf(epic.id);
      expect(row && epicProgress(row.children)).toMatchObject({ percent: 50, basis: "issues" });

      const empty = await create("epic", "Empty");
      const emptyRow = await epicOf(empty.id);
      expect(emptyRow?.children.total).toBe(0);
      expect(emptyRow && epicProgress(emptyRow.children).percent).toBeNull();
    });
  });

  describe("bar moves (schedule)", () => {
    it("saves both dates in one write, with one activity row per changed date", async () => {
      const epic = await create("epic", "Scheduled");
      const first = await schedule(epic.id, "2026-06-01", "2026-06-14");
      expect(first).toEqual({ from: "/", to: "2026-06-01/2026-06-14", changed: true });
      // A move by a week, as the bar drag or Shift+→ sends it.
      const moved = await schedule(epic.id, "2026-06-08", "2026-06-21");
      expect(moved.changed).toBe(true);
      // Only the end changes (a resize): one row.
      await schedule(epic.id, "2026-06-08", "2026-06-25");
      // No change: no row, and `updated_at` stays.
      const [before] = await db.select().from(issues).where(eq(issues.id, epic.id));
      expect((await schedule(epic.id, "2026-06-08", "2026-06-25")).changed).toBe(false);

      const [row] = await db.select().from(issues).where(eq(issues.id, epic.id));
      expect(row?.updatedAt).toEqual(before?.updatedAt);
      expect([row?.startDate, row?.dueDate]).toEqual(["2026-06-08", "2026-06-25"]);
      const rows = await db
        .select({ field: activity.field, from: activity.fromValue, to: activity.toValue })
        .from(activity)
        .where(
          and(
            eq(activity.entityType, "issue"),
            eq(activity.entityId, epic.id),
            eq(activity.action, "updated"),
          ),
        )
        .orderBy(activity.createdAt, activity.field);
      expect(rows).toEqual(
        expect.arrayContaining([
          { field: "startDate", from: null, to: "2026-06-01" },
          { field: "dueDate", from: null, to: "2026-06-14" },
          { field: "startDate", from: "2026-06-01", to: "2026-06-08" },
          { field: "dueDate", from: "2026-06-14", to: "2026-06-21" },
          { field: "dueDate", from: "2026-06-21", to: "2026-06-25" },
        ]),
      );
      expect(rows).toHaveLength(5);
      expect((await epicOf(epic.id))?.startDate).toBe("2026-06-08");
    });

    it("refuses a due date before the start through the plain dueDate field", async () => {
      const epic = await create("epic", "Ordered");
      await schedule(epic.id, "2026-06-10", "2026-06-20");
      await expect(
        service().updateIssueField(actor, {
          issueId: epic.id,
          field: "dueDate",
          value: "2026-06-09",
        }),
      ).rejects.toMatchObject({ message: "The due date is before the start date (2026-06-10)" });
      // On or after the start, and clearing it, are fine.
      await service().updateIssueField(actor, {
        issueId: epic.id,
        field: "dueDate",
        value: "2026-06-10",
      });
      await service().updateIssueField(actor, { issueId: epic.id, field: "dueDate", value: null });
      expect(await epicOf(epic.id)).toMatchObject({ startDate: "2026-06-10", dueDate: null });
    });

    it("clears both dates (Unscheduled), and refuses a deleted issue", async () => {
      const epic = await create("epic", "Cleared");
      await schedule(epic.id, "2026-06-01", "2026-06-14");
      await schedule(epic.id, null, null);
      expect(await epicOf(epic.id)).toMatchObject({ startDate: null, dueDate: null });
      await service().deleteIssue(actor, epic.id);
      await expect(schedule(epic.id, "2026-06-01", "2026-06-02")).rejects.toBeInstanceOf(
        ServiceError,
      );
    });
  });

  describe("filters", () => {
    it("filters by component, assignee (me / none / id) and status category", async () => {
      const [component] = await db
        .select({ id: components.id })
        .from(components)
        .where(eq(components.name, "infra"));
      if (!component) throw new Error("no infra component");
      const mine = await create("epic", "Mine");
      const theirs = await create("epic", "Theirs");
      const nobody = await create("epic", "Nobody");
      await service().updateIssueField(actor, {
        issueId: mine.id,
        field: "assignee",
        value: actor,
      });
      await service().updateIssueField(actor, {
        issueId: theirs.id,
        field: "assignee",
        value: other,
      });
      await service().updateIssueField(actor, {
        issueId: theirs.id,
        field: "component",
        value: component.id,
      });
      await setStatus(theirs.id, "In Progress");

      const ids = async (filters: Partial<typeof EMPTY_ROADMAP_FILTERS>) =>
        (await roadmap().listEpics(stk(), { ...EMPTY_ROADMAP_FILTERS, ...filters }, actor))
          .map((epic) => epic.id)
          .filter((id) => [mine.id, theirs.id, nobody.id].includes(id));

      expect(await ids({ assignees: ["me"] })).toEqual([mine.id]);
      expect(await ids({ assignees: [other] })).toEqual([theirs.id]);
      expect((await ids({ assignees: ["none"] })).includes(nobody.id)).toBe(true);
      expect((await ids({ assignees: ["none"] })).includes(mine.id)).toBe(false);
      expect(await ids({ components: [component.id] })).toEqual([theirs.id]);
      expect(await ids({ categories: ["in_progress"] })).toEqual([theirs.id]);
      expect((await ids({ categories: ["todo"] })).sort()).toEqual([mine.id, nobody.id].sort());
    });
  });

  describe("dependencies (RDM-2)", () => {
    it("lists blocks links between live epics only, in their stored direction", async () => {
      const a = await create("epic", "Blocker");
      const b = await create("epic", "Blocked");
      const story = await create("story", "Not an epic");
      const gone = await create("epic", "Trashed");
      // "B is blocked by A" is stored as "A blocks B".
      await service().addLink(actor, {
        issueId: b.id,
        relation: "is_blocked_by",
        targetKey: a.key,
      });
      await service().addLink(actor, { issueId: a.id, relation: "blocks", targetKey: story.key });
      await service().addLink(actor, { issueId: a.id, relation: "relates", targetKey: gone.key });
      await service().addLink(actor, { issueId: gone.id, relation: "blocks", targetKey: b.key });
      await service().deleteIssue(actor, gone.id);

      const dependencies = await roadmap().listDependencies(stk());
      expect(
        dependencies
          .filter((d) => [a.id, b.id, story.id, gone.id].includes(d.blockerId))
          .map((d) => [d.blockerId, d.blockedId]),
      ).toEqual([[a.id, b.id]]);
    });
  });

  describe("round trips (README Performance)", () => {
    function counted(): { read: Read; trips: () => number } {
      let flushes = 0;
      const read = createBatchedRead(
        () => Promise.reject(new Error("count only: run each query alone")),
        (flush) => {
          flushes += 1;
          setImmediate(flush);
        },
      );
      return { read, trips: () => flushes };
    }

    it("roadmap page: one round trip", async () => {
      const { read, trips } = counted();
      const issueQueries = createIssueQueries(db, { read });
      const queries = createRoadmapQueries(db, { read });
      const projectId = stk();
      const [, , , , project, epics, dependencies, meta] = await Promise.all([
        ...appLayoutReads(db, read, actor),
        issueQueries.getProject("STK"),
        queries.listEpics(projectId, { ...EMPTY_ROADMAP_FILTERS, assignees: ["me"] }, actor),
        queries.listDependencies(projectId),
        issueQueries.getProjectMeta(projectId),
      ]);
      expect(trips()).toBe(1);
      expect(project?.key).toBe("STK");
      expect(epics.length).toBeGreaterThan(0);
      expect(Array.isArray(dependencies)).toBe(true);
      expect(meta.statuses.length).toBeGreaterThan(0);
    });
  });
});
