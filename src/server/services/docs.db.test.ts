import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rt } from "@/lib/rich-text";
import { docs, docVersions, entityLinks, templates } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createDocQueries } from "./doc-queries";
import { createDocService, type CreateDocData } from "./docs";
import { ServiceError } from "./errors";
import { createIssueService } from "./issues";

/** Real Postgres (HQ_DB_TESTS=1): locking, numbering and tree rules live in SQL. */
describeDb("doc service (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let ada: string;
  let bob: string;
  let projectId: string;
  const service = () => createDocService(db, { runAtomic: transactionRunner(db) });
  const queries = () => createDocQueries(db);

  const create = (overrides: Partial<CreateDocData> = {}) =>
    service().createDoc(ada, { projectKey: "STK", title: "A doc", type: "page", ...overrides });

  async function docRow(id: string) {
    const [row] = await db.select().from(docs).where(eq(docs.id, id));
    if (!row) throw new Error("doc missing");
    return row;
  }

  async function versionsOf(id: string) {
    return db
      .select({ version: docVersions.version, authorId: docVersions.authorId })
      .from(docVersions)
      .where(eq(docVersions.docId, id))
      .orderBy(asc(docVersions.version));
  }

  const childrenOf = async (parentId: string | null) =>
    (await queries().listTree(projectId))
      .filter((doc) => doc.parentId === parentId)
      .map((doc) => doc.title);

  const expectServiceError = async (promise: Promise<unknown>, code: ServiceError["code"]) => {
    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ code });
  };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    const summary = await seed(db);
    projectId = summary.projectId;
    ada = await createTestUser(db, "Ada Actor");
    bob = await createTestUser(db, "Bob Builder");
  });

  afterAll(async () => {
    await testDb?.close();
  });

  describe("create and templates (DOC-5)", () => {
    it("creates a doc owned by the actor with a v1 snapshot", async () => {
      const { id, version } = await create({ title: "Plain page" });
      expect(version).toBe(1);
      const row = await docRow(id);
      expect(row).toMatchObject({ title: "Plain page", ownerId: ada, type: "page", version: 1 });
      expect(await versionsOf(id)).toEqual([{ version: 1, authorId: ada }]);
    });

    it("copies a template's content and sets the type and template_id", async () => {
      const [template] = await db
        .select()
        .from(templates)
        .where(and(eq(templates.kind, "doc"), eq(templates.subtype, "runbook")));
      if (!template) throw new Error("seed has no runbook template");
      const { id } = await create({ title: "Ops", templateId: template.id, type: "page" });
      const row = await docRow(id);
      expect(row.type).toBe("runbook");
      expect(row.templateId).toBe(template.id);
      expect(row.content).toEqual(template.content);
      expect(row.contentText).toContain("Alarms → actions table");
    });

    it("rejects a parent that does not exist", async () => {
      await expectServiceError(create({ parentId: crypto.randomUUID() }), "not_found");
    });
  });

  describe("optimistic locking (§7.4)", () => {
    it("detects a conflict, and Keep mine re-bases on the newer version", async () => {
      const { id } = await create({ title: "Locked" });
      const adaSave = await service().saveDoc(ada, {
        docId: id,
        baseVersion: 1,
        content: rt.doc(rt.paragraph("Ada's text")),
        snapshot: false,
      });
      expect(adaSave).toMatchObject({ status: "saved", version: 2 });

      // Bob's editor also started from v1: his save must not overwrite Ada's.
      const bobContent = rt.doc(rt.paragraph("Bob's text"));
      const bobSave = await service().saveDoc(bob, {
        docId: id,
        baseVersion: 1,
        content: bobContent,
        snapshot: false,
      });
      expect(bobSave).toMatchObject({
        status: "conflict",
        latest: { version: 2, updatedByName: "Ada Actor", title: "Locked" },
      });
      expect((await docRow(id)).contentText).toBe("Ada's text");

      // Keep mine: save again against the version the conflict reported.
      if (bobSave.status !== "conflict") throw new Error("expected a conflict");
      const keepMine = await service().saveDoc(bob, {
        docId: id,
        baseVersion: bobSave.latest.version,
        content: bobContent,
        snapshot: false,
      });
      expect(keepMine).toMatchObject({ status: "saved", version: 3 });
      expect(await docRow(id)).toMatchObject({
        version: 3,
        contentText: "Bob's text",
        updatedBy: bob,
      });

      // A stale Keep mine (someone saved again meanwhile) conflicts again; never blind.
      const stale = await service().saveDoc(ada, {
        docId: id,
        baseVersion: 2,
        content: rt.doc(rt.paragraph("old")),
        snapshot: false,
      });
      expect(stale).toMatchObject({ status: "conflict", latest: { version: 3 } });
    });

    it("only one of two concurrent saves from the same base wins", async () => {
      const { id } = await create({ title: "Race" });
      const results = await Promise.all(
        [ada, bob].map((actor) =>
          service().saveDoc(actor, {
            docId: id,
            baseVersion: 1,
            content: rt.doc(rt.paragraph(`by ${actor}`)),
            snapshot: false,
          }),
        ),
      );
      expect(results.map((result) => result.status).sort()).toEqual(["conflict", "saved"]);
      expect((await docRow(id)).version).toBe(2);
    });

    it("snapshots when the last snapshot is over 10 minutes old, or on Save version", async () => {
      const { id } = await create({ title: "History" });
      const save = (baseVersion: number, snapshot = false) =>
        service().saveDoc(ada, {
          docId: id,
          baseVersion,
          content: rt.doc(rt.paragraph(`v${baseVersion + 1}`)),
          snapshot,
        });
      // v1 was snapshotted at create a moment ago: no new snapshot.
      expect(await save(1)).toMatchObject({ status: "saved", version: 2, snapshotted: false });
      // Age the snapshots past the interval.
      await db.execute(
        sql`UPDATE doc_versions SET created_at = now() - interval '11 minutes' WHERE doc_id = ${id}::uuid`,
      );
      expect(await save(2)).toMatchObject({ version: 3, snapshotted: true });
      expect(await save(3)).toMatchObject({ version: 4, snapshotted: false });
      expect(await save(4, true)).toMatchObject({ version: 5, snapshotted: true });
      expect((await versionsOf(id)).map((row) => row.version)).toEqual([1, 3, 5]);
      const listed = await queries().listVersions(id);
      expect(listed.map((row) => [row.version, row.authorName])).toEqual([
        [5, "Ada Actor"],
        [3, "Ada Actor"],
        [1, "Ada Actor"],
      ]);
    });

    it("syncs mention links on save, but not for a save that lost", async () => {
      const issueService = createIssueService(db, { runAtomic: transactionRunner(db) });
      const first = await issueService.createIssue(ada, {
        projectKey: "STK",
        title: "Mentioned",
        type: "task",
        priority: 2,
      });
      const second = await issueService.createIssue(ada, {
        projectKey: "STK",
        title: "Other",
        type: "task",
        priority: 2,
      });
      const { id } = await create({ title: "Mentions" });
      await service().saveDoc(ada, {
        docId: id,
        baseVersion: 1,
        content: rt.doc(rt.paragraph(`See ${first.key}`)),
        snapshot: false,
      });
      const lost = await service().saveDoc(bob, {
        docId: id,
        baseVersion: 1,
        content: rt.doc(rt.paragraph(`See ${second.key}`)),
        snapshot: false,
      });
      expect(lost.status).toBe("conflict");
      const linked = await queries().linkedIssues(id);
      expect(linked.map((link) => [link.issue.key, link.origin])).toEqual([[first.key, "mention"]]);
      expect((await queries().docsLinkingTo(first.id)).map((doc) => doc.id)).toEqual([id]);

      // Manual link by key, then remove it.
      const { linkId } = await service().linkIssue(ada, { docId: id, issueKey: second.key });
      await expectServiceError(
        service().linkIssue(ada, { docId: id, issueKey: second.key }),
        "conflict",
      );
      expect((await queries().linkedIssues(id)).map((link) => link.origin)).toEqual([
        "mention",
        "manual",
      ]);
      await service().unlinkIssue(ada, { docId: id, linkId });
      const remaining = await db
        .select({ origin: entityLinks.origin })
        .from(entityLinks)
        .where(and(eq(entityLinks.fromType, "doc"), eq(entityLinks.fromId, id)));
      expect(remaining).toEqual([{ origin: "mention" }]);
    });
  });

  describe("page tree (DOC-2)", () => {
    it("moves among siblings and refuses to move a doc under its own descendant", async () => {
      const root = await create({ title: "Tree root" });
      const a = await create({ title: "A", parentId: root.id });
      const b = await create({ title: "B", parentId: root.id });
      const c = await create({ title: "C", parentId: root.id });
      expect(await childrenOf(root.id)).toEqual(["A", "B", "C"]);

      await service().moveDoc(ada, { docId: c.id, parentId: root.id, index: 0 });
      expect(await childrenOf(root.id)).toEqual(["C", "A", "B"]);
      await service().moveDoc(ada, { docId: c.id, parentId: root.id, index: 1 });
      expect(await childrenOf(root.id)).toEqual(["A", "C", "B"]);

      // Nest B under A, then try to put A under B (its child) and under itself.
      await service().moveDoc(ada, { docId: b.id, parentId: a.id, index: 0 });
      expect(await childrenOf(a.id)).toEqual(["B"]);
      await expectServiceError(
        service().moveDoc(ada, { docId: a.id, parentId: b.id, index: 0 }),
        "invalid",
      );
      await expectServiceError(
        service().moveDoc(ada, { docId: a.id, parentId: a.id, index: 0 }),
        "invalid",
      );
      expect((await docRow(a.id)).parentId).toBe(root.id);
    });

    it("never builds a cycle from two concurrent cross moves", async () => {
      const x = await create({ title: "X" });
      const y = await create({ title: "Y" });
      const outcomes = await Promise.allSettled([
        service().moveDoc(ada, { docId: x.id, parentId: y.id, index: 0 }),
        service().moveDoc(bob, { docId: y.id, parentId: x.id, index: 0 }),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      const [xRow, yRow] = [await docRow(x.id), await docRow(y.id)];
      expect(xRow.parentId === y.id && yRow.parentId === x.id).toBe(false);
    });

    it("lifts a deleted doc's children to its parent, in its place", async () => {
      const parent = await create({ title: "Parent" });
      await create({ title: "Before", parentId: parent.id });
      const middle = await create({ title: "Middle", parentId: parent.id });
      await create({ title: "After", parentId: parent.id });
      await create({ title: "Child 1", parentId: middle.id });
      await create({ title: "Child 2", parentId: middle.id });

      await service().deleteDoc(ada, middle.id);
      expect(await childrenOf(parent.id)).toEqual(["Before", "Child 1", "Child 2", "After"]);
      expect((await docRow(middle.id)).deletedAt).not.toBeNull();
      expect(await queries().getDoc(projectId, middle.id)).toBeNull();
      await expectServiceError(service().deleteDoc(ada, middle.id), "not_found");
    });

    it("renames non-ADR docs and bumps their version", async () => {
      const { id } = await create({ title: "Old" });
      expect(await service().renameDoc(ada, { docId: id, title: "New" })).toEqual({ version: 2 });
      expect((await docRow(id)).title).toBe("New");
    });
  });

  describe("ADRs (ADR-1, ADR-2)", () => {
    it("numbers ADRs uniquely under concurrent creates and uses the ADR template", async () => {
      // Every creator reads the same maximum before any insert lands (the worst case).
      const count = 6;
      let waiting = 0;
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const racing = createDocService(db, {
        runAtomic: transactionRunner(db),
        beforeAdrInsert: async () => {
          waiting += 1;
          if (waiting === count) release();
          await gate;
        },
      });
      const created = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          racing.createAdr(ada, { projectKey: "STK", title: `Decision ${i}` }),
        ),
      );
      const numbers = created.map((adr) => adr.number).sort((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
      const first = created.find((adr) => adr.number === 1);
      expect(first?.title).toMatch(/^0001\. Decision \d$/);
      const row = await docRow(first?.id ?? "");
      expect(row).toMatchObject({ type: "adr", adrStatus: "proposed", adrNumber: 1 });
      expect(row.contentText).toContain("Evidence (paths)");
      expect(row.templateId).not.toBeNull();
    });

    it("continues after the highest number, next to the latest ADR", async () => {
      const decisions = await create({ title: "Decisions" });
      await db
        .update(docs)
        .set({ adrNumber: 10, parentId: decisions.id })
        .where(and(eq(docs.projectId, projectId), eq(docs.adrNumber, 6)));
      const next = await service().createAdr(ada, { projectKey: "STK", title: "Next one" });
      expect(next).toMatchObject({ number: 11, title: "0011. Next one" });
      expect((await docRow(next.id)).parentId).toBe(decisions.id);
      const log = await queries().listAdrs(projectId);
      expect(log.at(-1)).toMatchObject({ number: 11, status: "proposed" });
    });

    it("sets Superseded only with a target ADR, and other statuses clear it", async () => {
      const older = await service().createAdr(ada, { projectKey: "STK", title: "Older" });
      const newer = await service().createAdr(ada, { projectKey: "STK", title: "Newer" });
      const page = await create({ title: "Not an ADR" });
      await expectServiceError(
        service().updateMeta(ada, { docId: older.id, field: "adrStatus", value: "superseded" }),
        "invalid",
      );
      await expectServiceError(
        service().updateMeta(ada, {
          docId: older.id,
          field: "adrStatus",
          value: "superseded",
          supersededBy: page.id,
        }),
        "not_found",
      );
      await service().updateMeta(ada, {
        docId: older.id,
        field: "adrStatus",
        value: "superseded",
        supersededBy: newer.id,
      });
      expect(await docRow(older.id)).toMatchObject({
        adrStatus: "superseded",
        adrSupersededBy: newer.id,
      });
      const log = await queries().listAdrs(projectId);
      expect(log.find((adr) => adr.id === older.id)?.supersededByNumber).toBe(newer.number);

      await service().updateMeta(ada, { docId: older.id, field: "adrStatus", value: "accepted" });
      expect(await docRow(older.id)).toMatchObject({
        adrStatus: "accepted",
        adrSupersededBy: null,
      });
      await expectServiceError(
        service().updateMeta(ada, { docId: page.id, field: "adrStatus", value: "accepted" }),
        "invalid",
      );
      await expectServiceError(
        service().updateMeta(ada, { docId: older.id, field: "type", value: "page" }),
        "invalid",
      );
      await expectServiceError(
        service().renameDoc(ada, { docId: older.id, title: "x" }),
        "invalid",
      );
    });
  });
});
