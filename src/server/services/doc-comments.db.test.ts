import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { anchorIdsInOrder, COMMENT_ANCHOR_MARK } from "@/lib/doc-comments/anchors";
import { type RichTextDoc, rt } from "@/lib/rich-text";
import { activity, comments, notifications } from "@/server/db/schema";
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

const anchoredDoc = (anchorId: string): RichTextDoc => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Intro " },
        {
          type: "text",
          text: "the claim",
          marks: [{ type: COMMENT_ANCHOR_MARK, attrs: { anchorId } }],
        },
      ],
    },
  ],
});

const mention = (userId: string): RichTextDoc => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "cc " },
        { type: "mention", attrs: { id: userId, label: "Someone" } },
      ],
    },
  ],
});

/** DOC-11 page-level and DOC-13 inline doc comments against Postgres (HQ_DB_TESTS=1). */
describeDb("doc comments (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let owner: string;
  let alice: string;
  let bob: string;
  let carol: string;
  let docId: string;

  const service = () => createCommentService(db, { runAtomic: transactionRunner(db) });
  const docs = () => createDocService(db, { runAtomic: transactionRunner(db) });

  const bellOf = async (userId: string) =>
    db
      .select({ type: notifications.type, meta: notifications.meta, actor: notifications.actorId })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.entityId, docId)));

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    owner = await createTestUser(db, "Owner");
    alice = await createTestUser(db, "Alice");
    bob = await createTestUser(db, "Bob");
    carol = await createTestUser(db, "Carol");
    docId = (await docs().createDoc(owner, { projectKey: "STK", title: "Spec", type: "page" })).id;
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("creates a page-level comment (no anchor) and an anchored one with its quote", async () => {
    const page = await service().createDocComment(alice, { docId, body: text("Overall fine") });
    const inline = await service().createDocComment(alice, {
      docId,
      body: text("Source?"),
      anchor: { id: "Anchor_0001", text: "the claim" },
    });
    expect(page.threadId).toBe(page.id);
    const rows = await db.select().from(comments).where(eq(comments.entityId, docId));
    expect(rows.find((row) => row.id === page.id)).toMatchObject({
      entityType: "doc",
      anchorId: null,
      anchorText: null,
      parentId: null,
    });
    expect(rows.find((row) => row.id === inline.id)).toMatchObject({
      anchorId: "Anchor_0001",
      anchorText: "the claim",
      bodyText: "Source?",
    });
  });

  it("enforces the anchor rules in the database too", async () => {
    // Anchors only on doc comments, and only well-formed ids (CHECKs from 0005).
    await expect(
      db.insert(comments).values({
        entityType: "issue",
        entityId: docId,
        authorId: alice,
        body: text("x"),
        anchorId: "abc",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(comments).values({
        entityType: "doc",
        entityId: docId,
        authorId: alice,
        body: text("x"),
        anchorId: "bad id!",
      }),
    ).rejects.toThrow();
  });

  it("allows replies one level deep only, on the same doc", async () => {
    const top = await service().createDocComment(alice, { docId, body: text("Top") });
    const reply = await service().createDocComment(bob, {
      docId,
      body: text("Reply"),
      parentId: top.id,
    });
    expect(reply.threadId).toBe(top.id);
    await expect(
      service().createDocComment(carol, { docId, body: text("Deeper"), parentId: reply.id }),
    ).rejects.toThrow("Reply to the first comment of a thread on this doc");
    const otherDoc = (
      await docs().createDoc(owner, { projectKey: "STK", title: "Other", type: "page" })
    ).id;
    await expect(
      service().createDocComment(carol, { docId: otherDoc, body: text("x"), parentId: top.id }),
    ).rejects.toThrow("Reply to the first comment");
    await expect(
      service().createDocComment(carol, {
        docId: crypto.randomUUID(),
        body: text("x"),
      }),
    ).rejects.toThrow("Doc not found");
  });

  it("resolves and reopens a thread on its top comment, logging each change once", async () => {
    const top = await service().createDocComment(alice, {
      docId,
      body: text("Fix this"),
      anchor: { id: "ResolveMe01", text: "the claim" },
    });
    const reply = await service().createDocComment(bob, {
      docId,
      body: text("Done"),
      parentId: top.id,
    });
    const resolved = await service().setThreadResolved(bob, { commentId: top.id, resolved: true });
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    // Repeating the same choice changes nothing.
    await service().setThreadResolved(carol, { commentId: top.id, resolved: true });
    const [row] = await db.select().from(comments).where(eq(comments.id, top.id));
    expect(row).toMatchObject({ resolvedBy: bob });
    expect(row?.resolvedAt?.getTime()).toBe(resolved.resolvedAt?.getTime());

    expect(
      await service().setThreadResolved(alice, { commentId: top.id, resolved: false }),
    ).toEqual({ resolvedAt: null });
    const [reopened] = await db.select().from(comments).where(eq(comments.id, top.id));
    expect(reopened).toMatchObject({ resolvedAt: null, resolvedBy: null });

    const log = await db
      .select({ action: activity.action, actor: activity.actorId, to: activity.toValue })
      .from(activity)
      .where(and(eq(activity.entityType, "comment"), eq(activity.entityId, top.id)))
      .orderBy(asc(activity.createdAt));
    expect(log.map((entry) => [entry.action, entry.actor])).toEqual([
      ["resolved", bob],
      ["reopened", alice],
    ]);
    expect(log[1]?.to).toBeNull();

    // Replies carry no resolution of their own.
    await expect(
      service().setThreadResolved(bob, { commentId: reply.id, resolved: true }),
    ).rejects.toThrow("Thread not found");
  });

  it("lists threads with replies; a deleted top stays as a placeholder while it has replies", async () => {
    const doc = (await docs().createDoc(owner, { projectKey: "STK", title: "List", type: "page" }))
      .id;
    const kept = await service().createDocComment(alice, { docId: doc, body: text("A") });
    await service().createDocComment(bob, { docId: doc, body: text("A1"), parentId: kept.id });
    const gone = await service().createDocComment(alice, { docId: doc, body: text("B") });
    const withReply = await service().createDocComment(alice, { docId: doc, body: text("C") });
    await service().createDocComment(bob, { docId: doc, body: text("C1"), parentId: withReply.id });
    await service().deleteComment(alice, gone.id);
    await service().deleteComment(alice, withReply.id);

    const threads = await service().listForDoc(doc);
    expect(
      threads.map((thread) => [thread.id, thread.body === null, thread.replies.length]),
    ).toEqual([
      [kept.id, false, 1],
      [withReply.id, true, 1],
    ]);
    expect(threads[0]?.authorName).toBe("Alice");

    // The placeholder thread can still be replied to and resolved.
    await service().createDocComment(carol, {
      docId: doc,
      body: text("C2"),
      parentId: withReply.id,
    });
    await expect(
      service().setThreadResolved(carol, { commentId: withReply.id, resolved: true }),
    ).resolves.toMatchObject({ resolvedAt: expect.any(Date) });
    const after = await service().listForDoc(doc);
    expect(after.find((thread) => thread.id === withReply.id)?.replies).toHaveLength(2);
    // A deleted top without live replies is hidden: no reply, no resolve.
    await expect(
      service().createDocComment(carol, { docId: doc, body: text("x"), parentId: gone.id }),
    ).rejects.toThrow("Reply to the first comment");
    await expect(
      service().setThreadResolved(carol, { commentId: gone.id, resolved: true }),
    ).rejects.toThrow("Thread not found");
  });

  it("notifies the doc owner and the thread's earlier participants, never the actor, once", async () => {
    const doc = (
      await docs().createDoc(owner, { projectKey: "STK", title: "Notify", type: "page" })
    ).id;
    docId = doc;
    // Alice starts a thread: the owner hears about it.
    const top = await service().createDocComment(alice, { docId: doc, body: text("Q") });
    // The owner replies: Alice (participant) hears about it; the owner (actor) does not.
    await service().createDocComment(owner, { docId: doc, body: text("A"), parentId: top.id });
    // Bob replies: owner and Alice, once each (the owner is owner AND participant).
    await service().createDocComment(bob, { docId: doc, body: text("+1"), parentId: top.id });
    // Carol is @mentioned by Alice: she gets the mention only, not comment_on_doc.
    await service().createDocComment(alice, { docId: doc, body: mention(carol), parentId: top.id });

    const types = async (userId: string) =>
      (await bellOf(userId)).map((entry) => entry.type).sort();
    expect(await types(owner)).toEqual(["comment_on_doc", "comment_on_doc", "comment_on_doc"]);
    expect(await types(alice)).toEqual(["comment_on_doc", "comment_on_doc"]);
    expect(await types(bob)).toEqual(["comment_on_doc"]);
    expect(await types(carol)).toEqual(["mentioned_in_doc"]);
    const [first] = await bellOf(owner);
    expect(first?.meta).toMatchObject({ threadId: top.id });
  });

  it("keeps comment marks through saveDoc and returns them on a conflict", async () => {
    const created = await docs().createDoc(owner, {
      projectKey: "STK",
      title: "Marks",
      type: "page",
    });
    const mine = anchoredDoc("KeepMark001");
    const saved = await docs().saveDoc(owner, {
      docId: created.id,
      baseVersion: created.version,
      content: mine,
      snapshot: false,
    });
    expect(saved.status).toBe("saved");
    const queries = createDocQueries(db);
    const stored = await queries.getDoc(projectIdByKey("STK"), created.id);
    expect(anchorIdsInOrder(stored?.content)).toEqual(["KeepMark001"]);

    // A stale save loses (§7.4) and gets the winner's copy, marks included.
    const stale = await docs().saveDoc(alice, {
      docId: created.id,
      baseVersion: created.version,
      content: anchoredDoc("Theirs00001"),
      snapshot: false,
    });
    expect(stale.status).toBe("conflict");
    if (stale.status !== "conflict") return;
    expect(anchorIdsInOrder(stale.latest.content)).toEqual(["KeepMark001"]);
  });

  it("doc page with comments: one round trip", async () => {
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
    const results = await Promise.all([
      ...appLayoutReads(db, read, owner),
      issueQueries.getProject("STK"),
      docQueries.getDoc(projectId, docId),
      docQueries.ancestors(docId),
      docQueries.linkedIssues(docId),
      docQueries.listVersions(docId),
      docQueries.listUsers(),
      issueQueries.listProjectKeys(),
      docQueries.supersedeOptions(projectId, docId),
      docQueries.listTree(projectId),
      createFileQueries(db, { read }).listAttachments("doc", docId),
      createCommentService(db, { runAtomic: transactionRunner(db), read }).listForDoc(docId),
    ]);
    expect(flushes).toBe(1);
    expect(results.at(-1)).toHaveLength(1);
  });
});
