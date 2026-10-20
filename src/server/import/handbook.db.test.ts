import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { docs, docVersions, entityLinks } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createDocQueries } from "@/server/services/doc-queries";
import { createDocService } from "@/server/services/docs";
import { createIssueService } from "@/server/services/issues";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { syntheticHandbook } from "./fixtures";
import { importHandbook, planHandbookImport } from "./handbook";

/** IMP-1/2/3 against a real Postgres (HQ_DB_TESTS=1), with synthetic markdown only. */
describeDb("handbook import (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let projectId: string;
  let actor: string;
  const run = (files = syntheticHandbook(), dryRun = false) =>
    importHandbook(db, planHandbookImport(files), {
      projectKey: "STK",
      dryRun,
      runAtomic: transactionRunner(db),
    });
  const imported = () =>
    db
      .select({
        id: docs.id,
        sourcePath: docs.sourcePath,
        parentId: docs.parentId,
        title: docs.title,
        type: docs.type,
        version: docs.version,
        adrNumber: docs.adrNumber,
        adrStatus: docs.adrStatus,
        adrSupersededBy: docs.adrSupersededBy,
        contentText: docs.contentText,
      })
      .from(docs)
      .where(and(eq(docs.projectId, projectId), isNotNull(docs.sourcePath)))
      .orderBy(asc(docs.sourcePath));

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    projectId = (await seed(db)).projectId;
    actor = await createTestUser(db);
    // STK-1 exists, so the README's mention becomes a link.
    await createIssueService(db, { runAtomic: transactionRunner(db) }).createIssue(actor, {
      projectKey: "STK",
      title: "Mentioned by the handbook",
      type: "task",
      priority: 2,
    });
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("a dry run writes nothing", async () => {
    const summary = await run(undefined, true);
    expect(summary.counts).toEqual({ create: 9, update: 0, unchanged: 0, skip: 2 });
    expect(await imported()).toEqual([]);
  });

  it("creates docs and ADRs with types, statuses, groups and supersession", async () => {
    const summary = await run();
    expect(summary.counts).toEqual({ create: 9, update: 0, unchanged: 0, skip: 2 });
    expect(summary.adrNumbers).toEqual([1, 2, 3]);

    const rows = await imported();
    const byPath = new Map(rows.map((row) => [row.sourcePath, row]));
    const handbook = byPath.get(".");
    const decisions = byPath.get("decisions");
    expect(handbook).toMatchObject({ title: "Handbook", parentId: null });
    expect(decisions).toMatchObject({ title: "Decisions", parentId: handbook?.id });
    expect(byPath.get("ARCHITECTURE.md")).toMatchObject({
      type: "design",
      parentId: handbook?.id,
      version: 1,
    });
    // Mermaid source is in the searchable text (DOC-7).
    expect(byPath.get("ARCHITECTURE.md")?.contentText).toContain("flowchart LR");
    expect(byPath.get("decisions/0001-first-choice.md")).toMatchObject({
      type: "adr",
      adrNumber: 1,
      adrStatus: "accepted_retrospective",
      title: "0001. First choice",
      parentId: decisions?.id,
    });
    expect(byPath.get("decisions/0002-second-choice.md")).toMatchObject({
      adrStatus: "superseded",
      adrSupersededBy: byPath.get("decisions/0003-third-choice.md")?.id,
    });

    // DOC-9: the README mentions STK-1.
    const readme = byPath.get("README.md");
    const links = await db
      .select({ origin: entityLinks.origin })
      .from(entityLinks)
      .where(and(eq(entityLinks.fromType, "doc"), eq(entityLinks.fromId, readme?.id ?? "")));
    expect(links).toEqual([{ origin: "mention" }]);
  });

  it("is idempotent, and a changed file updates in place with a new version and snapshot", async () => {
    const before = await imported();
    const again = await run();
    expect(again.counts).toEqual({ create: 0, update: 0, unchanged: 9, skip: 2 });
    expect(await imported()).toEqual(before);

    const changed = syntheticHandbook().map((file) =>
      file.path === "RUNBOOK.md"
        ? { ...file, markdown: "# Demo runbook\n\n- [x] checked\n" }
        : file,
    );
    const update = await run(changed);
    expect(update.counts).toEqual({ create: 0, update: 1, unchanged: 8, skip: 2 });
    const rows = await imported();
    expect(rows).toHaveLength(before.length);
    const runbook = rows.find((row) => row.sourcePath === "RUNBOOK.md");
    expect(runbook).toMatchObject({ version: 2, contentText: "checked" });
    const versions = await db
      .select({ version: docVersions.version })
      .from(docVersions)
      .where(eq(docVersions.docId, runbook?.id ?? ""))
      .orderBy(asc(docVersions.version));
    expect(versions).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it("keeps a doc where it was moved in HQ, and skips one deleted in HQ", async () => {
    const service = createDocService(db, { runAtomic: transactionRunner(db) });
    const rows = await imported();
    const runbook = rows.find((row) => row.sourcePath === "RUNBOOK.md");
    const notes = rows.find((row) => row.sourcePath === "NOTES.md");
    await service.moveDoc(actor, { docId: runbook?.id ?? "", parentId: null, index: 0 });
    await service.deleteDoc(actor, notes?.id ?? "");
    const summary = await run();
    expect(summary.results.find((result) => result.sourcePath === "NOTES.md")).toMatchObject({
      action: "skip",
      reason: "deleted in HQ",
    });
    expect((await imported()).find((row) => row.sourcePath === "RUNBOOK.md")?.parentId).toBeNull();
  });

  it('"New ADR" after the import continues the numbering', async () => {
    const service = createDocService(db, { runAtomic: transactionRunner(db) });
    const next = await service.createAdr(actor, { projectKey: "STK", title: "After import" });
    expect(next).toMatchObject({ number: 4, title: "0004. After import" });
    // It joins the imported ADRs under "Decisions".
    const decisions = (await imported()).find((row) => row.sourcePath === "decisions");
    const [row] = await db
      .select({ parentId: docs.parentId })
      .from(docs)
      .where(eq(docs.id, next.id));
    expect(row?.parentId).toBe(decisions?.id);
    const log = await createDocQueries(db).listAdrs(projectId);
    expect(log.map((adr) => adr.number)).toEqual([1, 2, 3, 4]);
  });

  it("skips an ADR whose number HQ already used, without failing the import", async () => {
    const files = [
      ...syntheticHandbook(),
      { path: "decisions/0004-clash.md", markdown: "# 0004. Clash\n\n## Status\n\nAccepted.\n" },
    ];
    const summary = await run(files);
    expect(
      summary.results.find((result) => result.sourcePath === "decisions/0004-clash.md"),
    ).toMatchObject({ action: "skip" });
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(docs)
      .where(and(eq(docs.projectId, projectId), eq(docs.adrNumber, 4)));
    expect(count?.n).toBe(1);
  });
});
