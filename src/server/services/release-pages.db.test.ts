import { afterAll, beforeAll, expect, it } from "vitest";

import { EMPTY_FILTERS } from "@/lib/issues/filters";
import { createBatchedRead, type Read } from "@/server/db/read-batch";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";
import { appLayoutReads } from "@/test/page-reads";

import { createImportQueries, createImportService } from "./imports";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import { createPlanningQueries } from "./planning-queries";
import { createReleaseQueries } from "./release-queries";
import { createReleaseService } from "./releases";
import { createSettingsQueries } from "./settings-queries";
import { projectIdByKey } from "./sql";

/**
 * README "Performance": the pages of slice B (P2) load in ONE round trip each, layout
 * included; counted as flushes of the read batcher, as in `sprint-pages.db.test.ts`.
 */
describeDb("round trips of the release and import pages (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let releaseId: string;

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
      releaseQueries: createReleaseQueries(db, { read }),
      settingsQueries: createSettingsQueries(db, { read }),
      importQueries: createImportQueries(db, { read }),
    };
  }

  const layout = (read: Read) => appLayoutReads(db, read, actor);
  const projectId = () => projectIdByKey("STK");

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Page Reader");
    const runAtomic = transactionRunner(db);
    releaseId = (
      await createReleaseService(db, { runAtomic }).createRelease(actor, {
        projectKey: "STK",
        name: "pages-v1",
        releaseDate: "2026-06-30",
        description: null,
      })
    ).id;
    await createIssueService(db, { runAtomic }).createIssue(actor, {
      projectKey: "STK",
      title: "In the release",
      type: "bug",
      priority: 1,
      releaseId,
    });
    const importService = createImportService(db, { runAtomic });
    const { importId } = await importService.preview(actor, {
      projectKey: "STK",
      filename: "pages.csv",
      fields: ["title"],
      rows: [["Imported"]],
    });
    await importService.apply(actor, { importId, fields: ["title"], rows: [["Imported"]] });
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("releases: one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const [, , , , , list] = await Promise.all([
      ...layout(read),
      s.issueQueries.getProject("STK"),
      s.releaseQueries.listReleases(projectId()),
    ]);
    expect(trips()).toBe(1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "pages-v1", total: { count: 1 }, done: { count: 0 } });
  });

  it("release page: one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const [, , , , , list, issues] = await Promise.all([
      ...layout(read),
      s.issueQueries.getProject("STK"),
      s.releaseQueries.listReleases(projectId()),
      s.releaseQueries.listReleaseIssues(projectId(), releaseId),
    ]);
    expect(trips()).toBe(1);
    expect(list.map((release) => release.id)).toEqual([releaseId]);
    expect(issues.map((issue) => issue.title)).toEqual(["In the release"]);
  });

  it("issue list filtered by fix version (with the releases in the meta): one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const [, , , , , issues, meta] = await Promise.all([
      ...layout(read),
      s.issueQueries.getProject("STK"),
      s.planningQueries.listIssues(projectId(), {
        scope: "all",
        filters: { ...EMPTY_FILTERS, releases: [releaseId] },
        currentUserId: actor,
      }),
      s.issueQueries.getProjectMeta(projectId()),
    ]);
    expect(trips()).toBe(1);
    expect(issues.map((issue) => issue.releaseId)).toEqual([releaseId]);
    expect(meta.releases).toEqual([{ id: releaseId, name: "pages-v1", state: "unreleased" }]);
  });

  it("project settings with the import history: one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const [, , , , , settings, history] = await Promise.all([
      ...layout(read),
      s.issueQueries.getProject("STK"),
      s.settingsQueries.getSettings(projectId()),
      s.importQueries.listImports(projectId()),
    ]);
    expect(trips()).toBe(1);
    expect(settings).not.toBeNull();
    expect(history).toMatchObject([{ filename: "pages.csv", status: "applied", createdCount: 1 }]);
  });
});
