import { afterAll, beforeAll, expect, it } from "vitest";

import { createBatchedRead, type Read } from "@/server/db/read-batch";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createStorage } from "@/server/storage/storage";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createDiagramQueries } from "./diagram-queries";
import { createDiagramService } from "./diagrams";
import { createIssueQueries } from "./issue-queries";
import { createSprintQueries } from "./sprint-queries";
import { projectIdByKey } from "./sql";

/**
 * README "Performance": the diagram pages load in ONE database round trip (see
 * sprint-pages.db.test.ts for how flushes are counted). Each block starts exactly the reads
 * its page (plus the app layout) starts.
 */
describeDb("round trips of the diagram pages (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let diagramId: string;

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
      sprintQueries: createSprintQueries(db, { read }),
      diagramQueries: createDiagramQueries(db, { read }),
    };
  }

  const layout = (s: ReturnType<typeof services>) =>
    [s.issueQueries.issueTemplates(), s.sprintQueries.openSprintOptionsByProject()] as const;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    const actor = await createTestUser(db, "Ada Actor");
    const service = createDiagramService(db, {
      runAtomic: transactionRunner(db),
      storage: createStorage(null),
    });
    diagramId = (
      await service.createDiagram(actor, { projectKey: "STK", title: "Flow", kind: "flow" })
    ).id;
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("diagram list (with a search): one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const [, , project, cards] = await Promise.all([
      ...layout(s),
      s.issueQueries.getProject("STK"),
      s.diagramQueries.listDiagrams(projectIdByKey("STK"), "flow"),
    ]);
    expect(trips()).toBe(1);
    expect(project?.key).toBe("STK");
    expect(cards.map((card) => card.id)).toEqual([diagramId]);
  });

  it("diagram editor: one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const [, , , diagram, versions, links] = await Promise.all([
      ...layout(s),
      s.issueQueries.getProject("STK"),
      s.diagramQueries.getDiagram(projectIdByKey("STK"), diagramId),
      s.diagramQueries.listVersions(diagramId),
      s.diagramQueries.links(diagramId),
    ]);
    expect(trips()).toBe(1);
    expect(diagram?.id).toBe(diagramId);
    expect(versions.map((v) => v.version)).toEqual([1]);
    expect(links).toEqual([]);
  });
});
