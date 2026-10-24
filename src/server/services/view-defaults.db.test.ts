import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { EMPTY_FILTERS } from "@/lib/issues/filters";
import { listDefaultFilters, saveViewDefaultsInput } from "@/lib/views/view-defaults";
import { createBatchedRead, type Read } from "@/server/db/read-batch";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";
import { appLayoutReads } from "@/test/page-reads";

import { ServiceError } from "./errors";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import { createPlanningQueries } from "./planning-queries";
import { createProjectSettingsService } from "./project-settings";
import { createSettingsQueries } from "./settings-queries";
import { createSprintQueries } from "./sprint-queries";
import { projectIdByKey, rowsOf } from "./sql";

/**
 * BRD-6 / VW-4 project view defaults (HQ_DB_TESTS=1): saving and resetting them, the "one
 * status stays visible" rule, the status-delete cleanup, the list query applying them only
 * when asked, and the pages that read them staying at one round trip.
 */
describeDb("view defaults (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let statusIds: Record<string, string>;
  let otherProjectStatus: string;

  const settings = () => createProjectSettingsService(db, { runAtomic: transactionRunner(db) });
  const issueQueries = () => createIssueQueries(db);
  const save = (input: unknown) =>
    settings().saveViewDefaults(actor, saveViewDefaultsInput.parse(input));
  const stk = () => projectIdByKey("STK");
  const defaults = async () => (await issueQueries().getProject("STK"))?.viewDefaults;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
    const meta = await issueQueries().getProjectMeta(stk());
    statusIds = Object.fromEntries(meta.statuses.map((status) => [status.name, status.id]));
    // Another project's status: never stored in STK's defaults.
    const other = await db.execute(sql`
      WITH p AS (INSERT INTO projects (key, name) VALUES ('OTH', 'Other') RETURNING id)
      INSERT INTO statuses (project_id, name, category, position)
      SELECT id, 'Todo', 'todo', 0 FROM p RETURNING id::text
    `);
    otherProjectStatus = rowsOf(other, z.object({ id: z.string() }))[0]?.id ?? "";
    const issues = createIssueService(db, { runAtomic: transactionRunner(db) });
    for (const [title, type] of [
      ["A bug", "bug"],
      ["A task", "task"],
      ["An epic", "epic"],
    ] as const) {
      await issues.createIssue(actor, { projectKey: "STK", title, type, priority: 2 });
    }
  });

  beforeEach(async () => {
    await save({
      projectKey: "STK",
      board: { issueTypes: null, hiddenStatusIds: [] },
      list: { issueTypes: null, hiddenStatusIds: [] },
    });
  });

  afterAll(async () => {
    await testDb?.close();
  });

  const id = (name: string) => statusIds[name] ?? "";

  it("saves and resets the board and list defaults, in workflow order, project statuses only", async () => {
    await save({
      projectKey: "STK",
      board: {
        issueTypes: ["task", "bug", "task"],
        hiddenStatusIds: [id("Done"), otherProjectStatus, id("Triage")],
      },
    });
    expect(await defaults()).toEqual({
      board: { issueTypes: ["task", "bug"], hiddenStatusIds: [id("Triage"), id("Done")] },
      list: { issueTypes: null, hiddenStatusIds: [] },
    });
    await save({ projectKey: "STK", list: { issueTypes: ["bug"], hiddenStatusIds: [] } });
    // A save of one side leaves the other alone.
    expect((await defaults())?.board.issueTypes).toEqual(["task", "bug"]);
    expect((await defaults())?.list.issueTypes).toEqual(["bug"]);
    // Reset: every type, nothing hidden (every type listed is stored as null too).
    await save({
      projectKey: "STK",
      board: {
        issueTypes: ["epic", "story", "task", "bug", "spike", "tech_debt", "subtask"],
        hiddenStatusIds: [id("Done")],
      },
    });
    expect((await defaults())?.board.issueTypes).toBeNull();
    await save({ projectKey: "STK", board: { issueTypes: [], hiddenStatusIds: [] } });
    expect((await defaults())?.board).toEqual({ issueTypes: null, hiddenStatusIds: [] });
  });

  it("keeps at least one status visible", async () => {
    const all = Object.values(statusIds);
    await expect(
      save({ projectKey: "STK", board: { issueTypes: null, hiddenStatusIds: all } }),
    ).rejects.toThrow(ServiceError);
    await expect(
      save({ projectKey: "STK", list: { issueTypes: null, hiddenStatusIds: all } }),
    ).rejects.toThrow("Keep at least one status visible");
    expect((await defaults())?.board.hiddenStatusIds).toEqual([]);
    await save({
      projectKey: "STK",
      board: { issueTypes: null, hiddenStatusIds: all.slice(1) },
    });
    expect((await defaults())?.board.hiddenStatusIds).toHaveLength(all.length - 1);
  });

  it("refuses an unknown project", async () => {
    await expect(
      save({ projectKey: "NOPE", board: { issueTypes: null, hiddenStatusIds: [] } }),
    ).rejects.toThrow("Project NOPE");
  });

  it("drops a deleted status from both hidden arrays in the delete statement", async () => {
    const created = await settings().createStatus(actor, {
      projectKey: "STK",
      name: "Parked",
      category: "todo",
    });
    await save({
      projectKey: "STK",
      board: { issueTypes: null, hiddenStatusIds: [created.id, id("Triage")] },
      list: { issueTypes: null, hiddenStatusIds: [created.id] },
    });
    await settings().deleteStatus(actor, { statusId: created.id });
    expect(await defaults()).toEqual({
      board: { issueTypes: null, hiddenStatusIds: [id("Triage")] },
      list: { issueTypes: null, hiddenStatusIds: [] },
    });
  });

  it("applies the list defaults in the query only when asked, as listDefaultFilters says", async () => {
    await save({
      projectKey: "STK",
      list: { issueTypes: ["bug", "task"], hiddenStatusIds: [id("Triage")] },
    });
    const planning = createPlanningQueries(db);
    const options = { scope: "all" as const, filters: EMPTY_FILTERS, currentUserId: actor };
    const plain = await planning.listIssues(stk(), options);
    const withDefaults = await planning.listIssues(stk(), { ...options, listDefaults: true });
    expect(plain.map((issue) => issue.title).sort()).toEqual(["A bug", "A task", "An epic"]);
    // New bugs start in Triage (hidden), new tasks in Backlog; the epic's type is not shown.
    expect(withDefaults.map((issue) => issue.title)).toEqual(["A task"]);
    // The same as the explicit filters the page shows for the defaults.
    const project = await issueQueries().getProject("STK");
    const meta = await issueQueries().getProjectMeta(stk());
    const explicit = listDefaultFilters(
      project?.viewDefaults.list ?? { issueTypes: null, hiddenStatusIds: [] },
      meta.statuses.map((status) => status.id),
    );
    const viaFilters = await planning.listIssues(stk(), {
      ...options,
      filters: { ...EMPTY_FILTERS, ...explicit },
    });
    expect(viaFilters.map((issue) => issue.id)).toEqual(withDefaults.map((issue) => issue.id));
  });

  it("shows every status when the stored hidden set covers them all", async () => {
    // Not writable through the service; a status delete or a hand edit could leave it.
    await db.execute(sql`UPDATE projects SET list_hidden_status_ids =
      ARRAY(SELECT id FROM statuses WHERE project_id = projects.id) WHERE key = 'STK'`);
    const listed = await createPlanningQueries(db).listIssues(stk(), {
      scope: "all",
      filters: EMPTY_FILTERS,
      currentUserId: actor,
      listDefaults: true,
    });
    expect(listed).toHaveLength(3);
  });

  describe("round trips with the defaults", () => {
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

    it("board: one round trip, defaults with the project", async () => {
      await save({ projectKey: "STK", board: { issueTypes: ["bug"], hiddenStatusIds: [] } });
      const { read, trips } = counted();
      const [, , , , project] = await Promise.all([
        ...appLayoutReads(db, read, actor),
        createIssueQueries(db, { read }).getProject("STK"),
        createPlanningQueries(db, { read }).listIssues(stk(), {
          scope: "board_sprint",
          filters: EMPTY_FILTERS,
          currentUserId: actor,
        }),
        createIssueQueries(db, { read }).getProjectMeta(stk()),
        createSprintQueries(db, { read }).getActiveSprint(stk()),
      ]);
      expect(trips()).toBe(1);
      expect(project?.viewDefaults.board.issueTypes).toEqual(["bug"]);
    });

    it("issue list with the defaults applied: one round trip", async () => {
      await save({ projectKey: "STK", list: { issueTypes: ["task"], hiddenStatusIds: [] } });
      const { read, trips } = counted();
      const [, , , , project, issues] = await Promise.all([
        ...appLayoutReads(db, read, actor),
        createIssueQueries(db, { read }).getProject("STK"),
        createPlanningQueries(db, { read }).listIssues(stk(), {
          scope: "all",
          filters: EMPTY_FILTERS,
          currentUserId: actor,
          listDefaults: true,
        }),
        createIssueQueries(db, { read }).getProjectMeta(stk()),
      ]);
      expect(trips()).toBe(1);
      expect(project?.viewDefaults.list.issueTypes).toEqual(["task"]);
      expect(issues.map((issue) => issue.type)).toEqual(["task"]);
    });

    it("project settings (Views tab): one round trip", async () => {
      await save({
        projectKey: "STK",
        board: { issueTypes: null, hiddenStatusIds: [id("Triage")] },
      });
      const { read, trips } = counted();
      const [, , , , , result] = await Promise.all([
        ...appLayoutReads(db, read, actor),
        createIssueQueries(db, { read }).getProject("STK"),
        createSettingsQueries(db, { read }).getSettings(stk()),
      ]);
      expect(trips()).toBe(1);
      expect(result?.viewDefaults.board.hiddenStatusIds).toEqual([id("Triage")]);
    });
  });
});
