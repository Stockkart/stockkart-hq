import { afterAll, beforeAll, expect, it } from "vitest";

import { EMPTY_FILTERS } from "@/lib/issues/filters";
import { createBatchedRead, type Read } from "@/server/db/read-batch";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import { createPlanningQueries } from "./planning-queries";
import { createSavedViewService } from "./saved-views";
import { createSettingsQueries } from "./settings-queries";
import { projectIdByKey } from "./sql";
import { createSprintQueries } from "./sprint-queries";
import { createTrashService } from "./trash";

/**
 * README "Performance": the pages of slice A (issue list with saved views, project settings,
 * trash) load in ONE round trip each, layout included; counted as flushes of the read
 * batcher, as in `sprint-pages.db.test.ts`.
 */
describeDb("round trips of the settings, trash and issue list pages (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let viewId: string;

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

  function services(read: Read) {
    return {
      issueQueries: createIssueQueries(db, { read }),
      planningQueries: createPlanningQueries(db, { read }),
      sprintQueries: createSprintQueries(db, { read }),
      savedViews: createSavedViewService(db, { read }),
      settingsQueries: createSettingsQueries(db, { read }),
      trash: createTrashService(db, { runAtomic: transactionRunner(db), read }),
    };
  }

  const layout = (s: ReturnType<typeof services>) =>
    [
      s.issueQueries.issueTemplates(),
      s.sprintQueries.openSprintOptionsByProject(),
      s.savedViews.listViews(actor, projectIdByKey("STK")),
    ] as const;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
    const issues = createIssueService(db, { runAtomic: transactionRunner(db) });
    const gone = await issues.createIssue(actor, {
      projectKey: "STK",
      title: "Trashed",
      type: "task",
      priority: 2,
    });
    await issues.deleteIssue(actor, gone.id);
    viewId = (
      await createSavedViewService(db).create(actor, {
        projectKey: "STK",
        name: "P0s",
        shared: false,
        query: "priority=0",
      })
    ).id;
  });

  afterAll(async () => {
    await testDb?.close();
  });

  const projectId = () => projectIdByKey("STK");

  it("issue list with an open saved view: one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const [, , views, , , , view] = await Promise.all([
      ...layout(s),
      s.issueQueries.getProject("STK"),
      s.planningQueries.listIssues(projectId(), {
        scope: "all",
        filters: EMPTY_FILTERS,
        currentUserId: actor,
      }),
      s.issueQueries.getProjectMeta(projectId()),
      s.savedViews.getView(actor, viewId),
    ]);
    expect(trips()).toBe(1);
    expect(views.map((v) => v.id)).toEqual([viewId]);
    expect(view?.filter).toEqual({ priority: "0" });
  });

  it("project settings: one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const [, , , , settings] = await Promise.all([
      ...layout(s),
      s.issueQueries.getProject("STK"),
      s.settingsQueries.getSettings(projectId()),
    ]);
    expect(trips()).toBe(1);
    expect(settings?.statuses.length).toBeGreaterThan(0);
  });

  it("trash: one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const [, , , , trash] = await Promise.all([
      ...layout(s),
      s.issueQueries.getProject("STK"),
      s.trash.listTrash(projectId()),
    ]);
    expect(trips()).toBe(1);
    expect(trash.issues).toHaveLength(1);
  });
});
