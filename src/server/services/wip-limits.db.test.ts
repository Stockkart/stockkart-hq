import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { EMPTY_FILTERS } from "@/lib/issues/filters";
import { wipState } from "@/lib/planning/wip";
import { projects, statuses } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import { createPlanningQueries } from "./planning-queries";
import { createPlanningService } from "./planning";
import { createProjectSettingsService } from "./project-settings";
import { createSettingsQueries } from "./settings-queries";
import { createSprintService } from "./sprints";
import { projectIdByKey } from "./sql";

/** BRD-5 WIP limits against real Postgres (HQ_DB_TESTS=1). */
describeDb("WIP limits (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let inProgress: string;
  const settings = () => createProjectSettingsService(db, { runAtomic: transactionRunner(db) });
  const stk = () => projectIdByKey("STK");

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
    const [row] = await db
      .select({ id: statuses.id })
      .from(statuses)
      .innerJoin(projects, eq(projects.id, statuses.projectId))
      .where(and(eq(projects.key, "STK"), eq(statuses.name, "In Progress")));
    if (!row) throw new Error("no In Progress status");
    inProgress = row.id;
  });

  afterAll(async () => {
    await testDb?.close();
  });

  const limitOf = async () =>
    (await createIssueQueries(db).getProjectMeta(stk())).statuses.find((s) => s.id === inProgress)
      ?.wipLimit;

  it("sets and clears a column's limit; the board and the settings page read it", async () => {
    expect(await limitOf()).toBeNull();
    await settings().setStatusWipLimit(actor, { statusId: inProgress, wipLimit: 4 });
    expect(await limitOf()).toBe(4);
    const status = (await createSettingsQueries(db).getSettings(stk()))?.statuses.find(
      (s) => s.id === inProgress,
    );
    expect(status?.wipLimit).toBe(4);
    await settings().setStatusWipLimit(actor, { statusId: inProgress, wipLimit: null });
    expect(await limitOf()).toBeNull();
    await expect(
      settings().setStatusWipLimit(actor, {
        statusId: "00000000-0000-4000-8000-000000000000",
        wipLimit: 2,
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/not found/i) });
  });

  it("keeps the 1–999 range in the database too", async () => {
    await expect(
      db.execute(sql`UPDATE statuses SET wip_limit = 1000 WHERE id = ${inProgress}::uuid`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`UPDATE statuses SET wip_limit = 0 WHERE id = ${inProgress}::uuid`),
    ).rejects.toThrow();
  });

  it("counts the cards of the board's scope: the active sprint, or every open issue", async () => {
    const issues = createIssueService(db, { runAtomic: transactionRunner(db) });
    const sprints = createSprintService(db, { runAtomic: transactionRunner(db) });
    const make = async (title: string) => {
      const issue = await issues.createIssue(actor, {
        projectKey: "STK",
        title,
        type: "task",
        priority: 2,
      });
      await issues.updateIssueField(actor, {
        issueId: issue.id,
        field: "status",
        value: inProgress,
      });
      return issue;
    };
    const inSprint = await make("In the sprint");
    await make("In the backlog");
    const { id: sprintId } = await sprints.createSprint(actor, {
      projectKey: "STK",
      name: "WIP sprint",
      goal: null,
      startDate: "2026-06-01",
      endDate: "2026-06-14",
    });
    await createPlanningService(db).moveIssueToSprint(actor, { issueId: inSprint.id, sprintId });
    await sprints.startSprint(actor, sprintId);
    await settings().setStatusWipLimit(actor, { statusId: inProgress, wipLimit: 1 });

    const column = async (scope: "board" | "board_sprint") =>
      (
        await createPlanningQueries(db).listIssues(stk(), {
          scope,
          filters: EMPTY_FILTERS,
          currentUserId: actor,
        })
      ).filter((issue) => issue.status.id === inProgress).length;

    const limit = await limitOf();
    expect(wipState(await column("board_sprint"), limit)).toMatchObject({
      label: "1 / 1",
      over: false,
    });
    expect(wipState(await column("board"), limit)).toMatchObject({ label: "2 / 1", over: true });
  });

  it("refuses a limit on an archived project's status", async () => {
    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.key, "STK"));
    try {
      await expect(
        settings().setStatusWipLimit(actor, { statusId: inProgress, wipLimit: 3 }),
      ).rejects.toMatchObject({ message: expect.stringMatching(/not found/i) });
    } finally {
      await db.update(projects).set({ archivedAt: null }).where(eq(projects.key, "STK"));
    }
    expect(await limitOf()).toBe(1);
  });
});
