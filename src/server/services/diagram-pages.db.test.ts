import { afterAll, beforeAll, expect, it } from "vitest";

import { createBatchedRead, type Read } from "@/server/db/read-batch";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createStorage } from "@/server/storage/storage";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";
import { appLayoutReads } from "@/test/page-reads";

import { createDiagramQueries } from "./diagram-queries";
import { createDiagramService } from "./diagrams";
import { createDocQueries } from "./doc-queries";
import { createDocService } from "./docs";
import { createFileQueries } from "./files";
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
  let actor: string;
  let diagramId: string;
  let docId: string;

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
      docQueries: createDocQueries(db, { read }),
      fileQueries: createFileQueries(db, { read }),
    };
  }

  /** The app layout's reads (templates, sprint options, sidebar views, the bell's count). */
  const layout = (read: Read) => appLayoutReads(db, read, actor);

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
    const service = createDiagramService(db, {
      runAtomic: transactionRunner(db),
      storage: createStorage(null),
    });
    diagramId = (
      await service.createDiagram(actor, { projectKey: "STK", title: "Flow", kind: "flow" })
    ).id;
    // A doc that embeds the diagram (DOC-8), for the doc page below.
    const docs = createDocService(db, { runAtomic: transactionRunner(db) });
    const doc = await docs.createDoc(actor, { projectKey: "STK", title: "Spec", type: "page" });
    await docs.saveDoc(actor, {
      docId: doc.id,
      baseVersion: doc.version,
      snapshot: false,
      content: {
        type: "doc",
        content: [
          {
            type: "diagramEmbed",
            attrs: { diagramId, title: "Flow", projectKey: "STK", kind: "flow" },
          },
        ],
      },
    });
    docId = doc.id;
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("diagram list (with a search): one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const [, , , , project, cards] = await Promise.all([
      ...layout(read),
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
    const [, , , , , diagram, versions, links] = await Promise.all([
      ...layout(read),
      s.issueQueries.getProject("STK"),
      s.diagramQueries.getDiagram(projectIdByKey("STK"), diagramId),
      s.diagramQueries.listVersions(diagramId),
      s.diagramQueries.links(diagramId),
    ]);
    expect(trips()).toBe(1);
    expect(diagram?.id).toBe(diagramId);
    expect(versions.map((v) => v.version)).toEqual([1]);
    // The doc embedding it (seeded above) shows in the Linked panel (DOC-8).
    expect(links).toEqual([expect.objectContaining({ key: `embed:doc:${docId}`, label: "Spec" })]);
  });

  it("doc page (diagram embed, attachments panel): one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const projectId = projectIdByKey("STK");
    const [, , , , , doc, , , , , , , tree, attachments] = await Promise.all([
      ...layout(read),
      s.issueQueries.getProject("STK"),
      s.docQueries.getDoc(projectId, docId),
      s.docQueries.ancestors(docId),
      s.docQueries.linkedIssues(docId),
      s.docQueries.listVersions(docId),
      s.docQueries.listUsers(),
      s.issueQueries.listProjectKeys(),
      s.docQueries.supersedeOptions(projectId, docId),
      s.docQueries.listTree(projectId),
      s.fileQueries.listAttachments("doc", docId),
    ]);
    expect(trips()).toBe(1);
    expect(JSON.stringify(doc?.content)).toContain(diagramId);
    expect(tree.map((item) => item.id)).toContain(docId);
    expect(attachments).toEqual([]);
  });
});
