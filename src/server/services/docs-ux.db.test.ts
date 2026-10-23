import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { anchorIdsInOrder, COMMENT_ANCHOR_MARK } from "@/lib/doc-comments/anchors";
import { type RichTextDoc, rt } from "@/lib/rich-text";
import { activity, docs as docsTable, docVersions } from "@/server/db/schema";
import { createBatchedRead, type Read } from "@/server/db/read-batch";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";
import { appLayoutReads } from "@/test/page-reads";

import { createCommentService } from "./comments";
import { createDocQueries } from "./doc-queries";
import { createDocService } from "./docs";
import { createFileQueries } from "./files";
import { createIssueQueries } from "./issue-queries";
import { projectIdByKey } from "./sql";

const text = (value: string) => rt.doc(rt.paragraph(value));

const anchored = (before: string, quoted: string, anchorId: string): RichTextDoc => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: before },
        { type: "text", text: quoted, marks: [{ type: COMMENT_ANCHOR_MARK, attrs: { anchorId } }] },
      ],
    },
  ],
});

/** Docs UX against Postgres (HQ_DB_TESTS=1): DOC-10 restore, ADR-3 supersede, page reads. */
describeDb("docs UX (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;

  const service = () => createDocService(db, { runAtomic: transactionRunner(db) });
  const comments = () => createCommentService(db, { runAtomic: transactionRunner(db) });
  const queries = () => createDocQueries(db);

  const activityOf = (entityId: string) =>
    db
      .select({
        action: activity.action,
        field: activity.field,
        from: activity.fromValue,
        to: activity.toValue,
      })
      .from(activity)
      .where(and(eq(activity.entityType, "doc"), eq(activity.entityId, entityId)))
      .orderBy(asc(activity.createdAt), asc(activity.action), asc(activity.field));

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
  });

  afterAll(async () => {
    await testDb?.close();
  });

  describe("DOC-10 restore", () => {
    it("creates a NEW version with the old title and content, snapshotted, and logs it", async () => {
      const created = await service().createDoc(actor, {
        projectKey: "STK",
        title: "Runbook",
        type: "page",
      });
      const v2 = await service().saveDoc(actor, {
        docId: created.id,
        baseVersion: 1,
        title: "Runbook v2",
        content: text("second"),
        snapshot: true,
      });
      expect(v2).toMatchObject({ status: "saved", version: 2 });

      const restored = await service().restoreVersion(actor, {
        docId: created.id,
        version: 1,
        baseVersion: 2,
      });
      expect(restored).toEqual({ status: "saved", version: 3, snapshotted: true });

      const [row] = await db
        .select({ title: docsTable.title, version: docsTable.version })
        .from(docsTable)
        .where(eq(docsTable.id, created.id));
      expect(row).toEqual({ title: "Runbook", version: 3 });
      // The history keeps every version; nothing was rewritten.
      const history = await db
        .select({ version: docVersions.version, title: docVersions.title })
        .from(docVersions)
        .where(eq(docVersions.docId, created.id))
        .orderBy(asc(docVersions.version));
      expect(history).toEqual([
        { version: 1, title: "Runbook" },
        { version: 2, title: "Runbook v2" },
        { version: 3, title: "Runbook" },
      ]);
      expect(await activityOf(created.id)).toContainEqual({
        action: "restored",
        field: "version",
        from: "1",
        to: "3",
      });
      // The version view used by the diff.
      const detail = await queries().getVersion(created.id, 2);
      expect(detail).toMatchObject({ version: 2, title: "Runbook v2", authorName: "Ada Actor" });
      expect(await queries().getVersion(created.id, 99)).toBeNull();
    });

    it("refuses a stale base version (the conflict banner path) and changes nothing", async () => {
      const created = await service().createDoc(actor, {
        projectKey: "STK",
        title: "Stale",
        type: "page",
      });
      await service().saveDoc(actor, {
        docId: created.id,
        baseVersion: 1,
        content: text("newer"),
        snapshot: false,
      });
      const result = await service().restoreVersion(actor, {
        docId: created.id,
        version: 1,
        baseVersion: 1,
      });
      expect(result).toMatchObject({ status: "conflict", latest: { version: 2 } });
      expect(
        (await activityOf(created.id)).filter((row) => row.action === "restored"),
      ).toHaveLength(0);
      await expect(
        service().restoreVersion(actor, { docId: created.id, version: 42, baseVersion: 2 }),
      ).rejects.toThrow("Version 42 not found");
    });

    it("keeps comment anchors that still have a thread, and re-anchors moved ones", async () => {
      const created = await service().createDoc(actor, {
        projectKey: "STK",
        title: "Anchors",
        type: "page",
      });
      // v2 (kept): an anchor with a thread ("kept1") and one without ("stray1").
      await service().saveDoc(actor, {
        docId: created.id,
        baseVersion: 1,
        snapshot: true,
        content: {
          type: "doc",
          content: [
            anchored("Intro ", "the claim", "kept1").content?.[0] ?? rt.paragraph(),
            anchored("Also ", "noise", "stray1").content?.[0] ?? rt.paragraph(),
            rt.paragraph("Later text"),
          ],
        },
      });
      await comments().createDocComment(actor, {
        docId: created.id,
        body: text("Is it?"),
        anchor: { id: "kept1", text: "the claim" },
      });
      // v3: the current content anchors "Later text" in a new thread.
      await service().saveDoc(actor, {
        docId: created.id,
        baseVersion: 2,
        snapshot: true,
        content: anchored("", "Later text", "later1"),
      });
      await comments().createDocComment(actor, {
        docId: created.id,
        body: text("Why later?"),
        anchor: { id: "later1", text: "Later text" },
      });

      const result = await service().restoreVersion(actor, {
        docId: created.id,
        version: 2,
        baseVersion: 3,
      });
      expect(result).toMatchObject({ status: "saved", version: 4 });
      const [row] = await db
        .select({ content: docsTable.content })
        .from(docsTable)
        .where(eq(docsTable.id, created.id));
      // kept1 stays, stray1 (no thread) is dropped, later1 is found again in v2's text.
      expect(anchorIdsInOrder(row?.content)).toEqual(["kept1", "later1"]);
    });
  });

  describe("ADR-3 supersede", () => {
    it("creates the next ADR and supersedes the old one atomically, with activity on both", async () => {
      const old = await service().createAdr(actor, { projectKey: "STK", title: "Use cron" });
      const successor = await service().supersedeAdr(actor, {
        docId: old.id,
        title: "Use a queue",
      });
      expect(successor.number).toBe(old.number + 1);
      expect(successor.title).toBe(`${String(old.number + 1).padStart(4, "0")}. Use a queue`);

      const rows = await db
        .select({
          id: docsTable.id,
          status: docsTable.adrStatus,
          supersededBy: docsTable.adrSupersededBy,
          content: docsTable.content,
        })
        .from(docsTable)
        .where(inArray(docsTable.id, [old.id, successor.id]));
      const oldRow = rows.find((item) => item.id === old.id);
      const newRow = rows.find((item) => item.id === successor.id);
      expect(oldRow).toMatchObject({ status: "superseded", supersededBy: successor.id });
      expect(newRow).toMatchObject({ status: "proposed", supersededBy: null });
      // The Context bullet links the old ADR's handbook file.
      const oldNumber = String(old.number).padStart(4, "0");
      expect(JSON.stringify(newRow?.content)).toContain(`"text":"${oldNumber}"`);
      expect(JSON.stringify(newRow?.content)).toContain(`${oldNumber}-use-cron.md`);

      expect(await activityOf(old.id)).toEqual(
        expect.arrayContaining([
          { action: "updated", field: "adrStatus", from: "proposed", to: "superseded" },
          { action: "updated", field: "adrSupersededBy", from: null, to: successor.id },
        ]),
      );
      expect(await activityOf(successor.id)).toEqual(
        expect.arrayContaining([
          { action: "created", field: null, from: null, to: "adr" },
          { action: "supersedes", field: "adrSupersedes", from: null, to: old.id },
        ]),
      );
      // The banners' reads.
      expect(await queries().supersedes(successor.id)).toEqual([
        { id: old.id, title: `${oldNumber}. Use cron`, adrNumber: old.number },
      ]);
      const oldDetail = await queries().getDoc(projectIdByKey("STK"), old.id);
      expect(oldDetail?.adrSupersededBy).toEqual({ id: successor.id, title: successor.title });
    });

    it("blocks an ADR that is already superseded, and a non-ADR", async () => {
      const old = await service().createAdr(actor, { projectKey: "STK", title: "Twice" });
      const first = await service().supersedeAdr(actor, { docId: old.id, title: "Once" });
      await expect(
        service().supersedeAdr(actor, { docId: old.id, title: "Again" }),
      ).rejects.toThrow(`Already superseded by ADR-${String(first.number).padStart(4, "0")}`);
      const page = await service().createDoc(actor, {
        projectKey: "STK",
        title: "Page",
        type: "page",
      });
      await expect(
        service().supersedeAdr(actor, { docId: page.id, title: "Nope" }),
      ).rejects.toThrow("Only ADRs can be superseded");
    });

    it("lets only one of two concurrent supersedes win (no orphan successor)", async () => {
      const old = await service().createAdr(actor, { projectKey: "STK", title: "Race" });
      const before = await db.select({ id: docsTable.id }).from(docsTable);
      const results = await Promise.allSettled([
        service().supersedeAdr(actor, { docId: old.id, title: "Left" }),
        service().supersedeAdr(actor, { docId: old.id, title: "Right" }),
      ]);
      const won = results.filter((result) => result.status === "fulfilled");
      expect(won).toHaveLength(1);
      const after = await db.select({ id: docsTable.id }).from(docsTable);
      expect(after.length - before.length).toBe(1);
    });
  });

  it("doc page (with the supersedes banner read): one round trip", async () => {
    const adr = await service().createAdr(actor, { projectKey: "STK", title: "Counted" });
    let flushes = 0;
    const read: Read = createBatchedRead(
      () => Promise.reject(new Error("count only: run each query alone")),
      (flush) => {
        flushes += 1;
        setImmediate(flush);
      },
    );
    const docQueries = createDocQueries(db, { read });
    const issueQueries = createIssueQueries(db, { read });
    const projectId = projectIdByKey("STK");
    // Exactly the reads `docs/[id]/page.tsx` starts (plus the app layout's).
    const results = await Promise.all([
      ...appLayoutReads(db, read, actor),
      issueQueries.getProject("STK"),
      docQueries.getDoc(projectId, adr.id),
      docQueries.ancestors(adr.id),
      docQueries.linkedIssues(adr.id),
      docQueries.listVersions(adr.id),
      docQueries.listUsers(),
      issueQueries.listProjectKeys(),
      docQueries.supersedeOptions(projectId, adr.id),
      docQueries.listTree(projectId),
      createFileQueries(db, { read }).listAttachments("doc", adr.id),
      createCommentService(db, { runAtomic: transactionRunner(db), read }).listForDoc(adr.id),
      docQueries.supersedes(adr.id),
    ]);
    expect(flushes).toBe(1);
    expect(results.at(-1)).toEqual([]);
  });
});
