import { randomUUID } from "node:crypto";

import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type StartUploadInput } from "@/lib/attachments/schemas";
import { createBatchedRead } from "@/server/db/read-batch";
import { activity, attachments } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createStorage, type StorageTransport } from "@/server/storage/storage";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createAttachmentService, PENDING_LIMIT } from "./attachments";
import { createCommentService } from "./comments";
import { createDocService } from "./docs";
import { createFileQueries } from "./files";
import { createIssueService } from "./issues";

/**
 * ISS-9 upload flow against Postgres (HQ_DB_TESTS=1), with the real storage module on an
 * in-memory transport: presigning is local, HEAD/DELETE hit the fake bucket below.
 */

interface FakeObject {
  size: number;
  type: string;
}

function fakeBucket() {
  const objects = new Map<string, FakeObject>();
  const deleted: string[] = [];
  const transport: StorageTransport = {
    async send(command) {
      if (command instanceof HeadObjectCommand) {
        const object = objects.get(command.input.Key ?? "");
        if (!object) throw Object.assign(new Error("NotFound"), { name: "NotFound" });
        return { ContentLength: object.size, ContentType: object.type };
      }
      if (command instanceof DeleteObjectCommand) {
        deleted.push(command.input.Key ?? "");
        objects.delete(command.input.Key ?? "");
        return {};
      }
      throw new Error("unexpected command");
    },
    async presign(command) {
      return `https://r2.invalid/${command.input.Key}?X-Amz-Signature=test`;
    },
  };
  return { objects, deleted, transport };
}

const CONFIG = { accountId: "acct", accessKeyId: "id", secretAccessKey: "secret", bucket: "b" };

describeDb("attachment service (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let other: string;
  let issueId: string;
  let bucket: ReturnType<typeof fakeBucket>;

  const issues = () => createIssueService(db, { runAtomic: transactionRunner(db) });
  const service = (configured = true) =>
    createAttachmentService(db, {
      storage: createStorage(configured ? CONFIG : null, () => bucket.transport),
    });
  const files = () => createFileQueries(db);
  const newIssue = async (title = "Has files") =>
    (await issues().createIssue(actor, { projectKey: "STK", title, type: "task", priority: 2 })).id;
  const input = (overrides: Partial<StartUploadInput> = {}): StartUploadInput => ({
    entityType: "issue",
    entityId: issueId,
    filename: "Screen Shot.png",
    mime: "image/png",
    size: 1234,
    width: 800,
    height: 600,
    ...overrides,
  });
  /** Simulates the browser's PUT of exactly what was announced. */
  const putAnnounced = async (attachmentId: string) => {
    const [row] = await db.select().from(attachments).where(eq(attachments.id, attachmentId));
    if (!row) throw new Error("no row");
    bucket.objects.set(row.storageKey, { size: row.sizeBytes, type: row.mime });
    return row;
  };
  const upload = async (actorId: string, overrides: Partial<StartUploadInput> = {}) => {
    const started = await service().startUpload(actorId, input(overrides));
    await putAnnounced(started.attachmentId);
    return service().confirmUpload(actorId, started.attachmentId);
  };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Uploader");
    other = await createTestUser(db, "Ben Other");
    issueId = await newIssue();
  });

  beforeEach(() => {
    bucket = fakeBucket();
  });

  afterAll(async () => {
    await testDb?.close();
  });

  describe("startUpload", () => {
    it("inserts a pending row with the key layout and returns a signed PUT", async () => {
      const started = await service().startUpload(actor, input());
      expect(started.url).toMatch(
        /^https:\/\/r2\.invalid\/attachments\/[0-9a-f-]{36}\/Screen_Shot\.png/,
      );
      expect(started.headers).toEqual({ "Content-Type": "image/png" });
      expect(started.filename).toBe("Screen Shot.png");
      const [row] = await db
        .select()
        .from(attachments)
        .where(eq(attachments.id, started.attachmentId));
      expect(row).toMatchObject({
        entityType: "issue",
        entityId: issueId,
        storageKey: `attachments/${started.attachmentId}/Screen_Shot.png`,
        filename: "Screen Shot.png",
        mime: "image/png",
        sizeBytes: 1234,
        width: 800,
        height: 600,
        uploadedBy: actor,
        status: "pending",
      });
    });

    it("stores the policy's type, not the client's (SVG and HTML download as octet-stream)", async () => {
      for (const [filename, mime, stored] of [
        ["evil.svg", "image/svg+xml", "application/octet-stream"],
        ["x.png", "text/html", "application/octet-stream"],
        ["server.log", "", "text/plain; charset=utf-8"],
        ["../../backups/dump.sql.gz", "application/gzip", "application/octet-stream"],
      ] as const) {
        const started = await service().startUpload(
          actor,
          input({ filename, mime, width: 10, height: 10 }),
        );
        expect(started.headers["Content-Type"]).toBe(stored);
        const [row] = await db
          .select()
          .from(attachments)
          .where(eq(attachments.id, started.attachmentId));
        expect(row?.mime).toBe(stored);
        expect(row?.storageKey).toMatch(
          /^attachments\/[0-9a-f-]{36}\/[A-Za-z0-9-][A-Za-z0-9._-]*$/,
        );
        // Dimensions only for images.
        expect(row?.width).toBeNull();
      }
      await db.delete(attachments).where(eq(attachments.uploadedBy, actor));
    });

    it("refuses a missing or deleted parent", async () => {
      await expect(
        service().startUpload(actor, input({ entityId: randomUUID() })),
      ).rejects.toMatchObject({ code: "not_found" });
      const gone = await newIssue("Deleted");
      await issues().deleteIssue(actor, gone);
      await expect(service().startUpload(actor, input({ entityId: gone }))).rejects.toMatchObject({
        code: "not_found",
        message: "Issue not found",
      });
      await expect(
        service().startUpload(actor, input({ entityType: "doc", entityId: issueId })),
      ).rejects.toMatchObject({ code: "not_found", message: "Doc not found" });
    });

    it("fails gracefully, writing nothing, while storage is not configured", async () => {
      const before = await db.$count(attachments);
      await expect(service(false).startUpload(actor, input())).rejects.toMatchObject({
        code: "invalid",
        message: "File storage isn't set up yet",
      });
      await expect(service(false).confirmUpload(actor, randomUUID())).rejects.toMatchObject({
        message: "File storage isn't set up yet",
      });
      expect(await db.$count(attachments)).toBe(before);
    });

    it(`allows at most ${PENDING_LIMIT} pending uploads per user per 10 minutes`, async () => {
      const user = await createTestUser(db, "Busy Uploader");
      for (let index = 0; index < PENDING_LIMIT; index += 1) {
        await service().startUpload(user, input());
      }
      await expect(service().startUpload(user, input())).rejects.toMatchObject({
        code: "invalid",
        message: expect.stringMatching(/Too many uploads/),
      });
      // Others are not affected; nor are the same user's older pending rows.
      await expect(service().startUpload(other, input())).resolves.toBeDefined();
      await db.execute(
        sql`UPDATE attachments SET created_at = now() - interval '11 minutes' WHERE uploaded_by = ${user}::uuid`,
      );
      await expect(service().startUpload(user, input())).resolves.toBeDefined();
    });
  });

  describe("confirmUpload", () => {
    it("marks a matching upload ready and logs it on the issue", async () => {
      const view = await upload(actor);
      expect(view).toMatchObject({
        entityType: "issue",
        entityId: issueId,
        filename: "Screen Shot.png",
        uploaderName: "Ada Uploader",
      });
      expect(view).not.toHaveProperty("storageKey");
      const [row] = await db.select().from(attachments).where(eq(attachments.id, view.id));
      expect(row?.status).toBe("ready");
      const logged = await db
        .select()
        .from(activity)
        .where(and(eq(activity.entityId, issueId), eq(activity.action, "attachment_added")));
      expect(logged.map((entry) => entry.meta)).toContainEqual(
        expect.objectContaining({ name: "Screen Shot.png", attachmentId: view.id }),
      );
      // Twice is harmless.
      await expect(service().confirmUpload(actor, view.id)).resolves.toMatchObject({ id: view.id });
    });

    it.each([
      ["a different size", { size: 9999, type: "image/png" }],
      ["a different type", { size: 1234, type: "text/html" }],
    ])("deletes the object and the row when the upload has %s", async (_label, object) => {
      const started = await service().startUpload(actor, input());
      const row = await putAnnounced(started.attachmentId);
      bucket.objects.set(row.storageKey, object);
      await expect(service().confirmUpload(actor, started.attachmentId)).rejects.toMatchObject({
        code: "invalid",
      });
      expect(bucket.deleted).toEqual([row.storageKey]);
      expect(await db.$count(attachments, eq(attachments.id, started.attachmentId))).toBe(0);
    });

    it("deletes the row when nothing arrived", async () => {
      const started = await service().startUpload(actor, input());
      await expect(service().confirmUpload(actor, started.attachmentId)).rejects.toMatchObject({
        message: "The upload didn't arrive; try again",
      });
      expect(bucket.deleted).toEqual([]);
      expect(await db.$count(attachments, eq(attachments.id, started.attachmentId))).toBe(0);
    });

    it("only lets the uploader confirm", async () => {
      const started = await service().startUpload(actor, input());
      await putAnnounced(started.attachmentId);
      await expect(service().confirmUpload(other, started.attachmentId)).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });

  describe("deleteAttachment", () => {
    it("soft-deletes for the uploader only, keeps the object, logs it", async () => {
      const view = await upload(actor);
      await expect(service().deleteAttachment(other, view.id)).rejects.toMatchObject({
        code: "forbidden",
      });
      await expect(service().deleteAttachment(actor, view.id)).resolves.toEqual({
        entityType: "issue",
      });
      const [row] = await db.select().from(attachments).where(eq(attachments.id, view.id));
      expect(row?.deletedAt).toBeInstanceOf(Date);
      expect(bucket.deleted).toEqual([]);
      expect(await files().readyAttachment(view.id)).toBeNull();
      await expect(service().deleteAttachment(actor, view.id)).rejects.toMatchObject({
        code: "not_found",
      });
      expect(
        await db.$count(
          activity,
          and(eq(activity.entityId, issueId), eq(activity.action, "attachment_removed")),
        ),
      ).toBe(1);
    });
  });

  describe("downloads (readyAttachment) and the panel list", () => {
    it("serves only ready files of live parents", async () => {
      const parent = await newIssue("Parent to delete");
      const view = await upload(actor, { entityId: parent });
      expect(await files().readyAttachment(view.id)).toMatchObject({
        storageKey: expect.stringMatching(/^attachments\//),
        mime: "image/png",
      });
      const pending = await service().startUpload(actor, input({ entityId: parent }));
      expect(await files().readyAttachment(pending.attachmentId)).toBeNull();
      expect((await files().listAttachments("issue", parent)).map((item) => item.id)).toEqual([
        view.id,
      ]);

      await issues().deleteIssue(actor, parent);
      expect(await files().readyAttachment(view.id)).toBeNull();
    });

    it("hides a comment's files with the comment, and a doc's with the doc", async () => {
      const comments = createCommentService(db, { runAtomic: transactionRunner(db) });
      const comment = await comments.createComment(actor, {
        issueId,
        body: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
        },
      });
      const onComment = await upload(actor, { entityType: "comment", entityId: comment.id });
      expect(await files().readyAttachment(onComment.id)).not.toBeNull();
      // Inline only: not in the issue's panel.
      expect((await files().listAttachments("issue", issueId)).map((i) => i.id)).not.toContain(
        onComment.id,
      );
      await comments.deleteComment(actor, comment.id);
      expect(await files().readyAttachment(onComment.id)).toBeNull();

      const docs = createDocService(db, { runAtomic: transactionRunner(db) });
      const doc = await docs.createDoc(actor, { projectKey: "STK", title: "Spec", type: "page" });
      const onDoc = await upload(actor, { entityType: "doc", entityId: doc.id });
      expect((await files().listAttachments("doc", doc.id)).map((i) => i.id)).toEqual([onDoc.id]);
      expect(await files().readyAttachment(onDoc.id)).not.toBeNull();
      await docs.deleteDoc(actor, doc.id);
      expect(await files().readyAttachment(onDoc.id)).toBeNull();
    });

    it("lists in the page's single batched round trip", async () => {
      let batches = 0;
      const read = createBatchedRead(async (queries) => {
        batches += 1;
        const results: unknown[] = [];
        for (const query of queries) results.push(await query);
        return results;
      });
      const queries = createFileQueries(db, { read });
      await Promise.all([
        queries.listAttachments("issue", issueId),
        queries.listAttachments("doc", randomUUID()),
      ]);
      expect(batches).toBe(1);
    });
  });

  describe("adoptForComment", () => {
    it("moves the author's draft uploads from the issue onto the new comment", async () => {
      const comments = createCommentService(db, { runAtomic: transactionRunner(db) });
      const draft = await upload(actor);
      const theirs = await upload(other);
      const comment = await comments.createComment(actor, {
        issueId,
        body: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "y" }] }],
        },
      });
      await expect(
        service().adoptForComment(actor, {
          commentId: comment.id,
          attachmentIds: [draft.id, theirs.id],
        }),
      ).resolves.toEqual({ moved: 1 });
      const [moved] = await db.select().from(attachments).where(eq(attachments.id, draft.id));
      expect(moved).toMatchObject({ entityType: "comment", entityId: comment.id });
      const [kept] = await db.select().from(attachments).where(eq(attachments.id, theirs.id));
      expect(kept).toMatchObject({ entityType: "issue", entityId: issueId });
      // Only the comment's author.
      await expect(
        service().adoptForComment(other, { commentId: comment.id, attachmentIds: [theirs.id] }),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("purgeStalePending", () => {
    it("deletes pending uploads older than a day, objects first", async () => {
      const stale = await service().startUpload(other, input());
      const fresh = await service().startUpload(other, input());
      const ready = await upload(other);
      const staleRow = await putAnnounced(stale.attachmentId);
      await db.execute(
        sql`UPDATE attachments SET created_at = now() - interval '25 hours'
          WHERE id IN (${stale.attachmentId}::uuid, ${ready.id}::uuid)`,
      );
      expect(await service().purgeStalePending(100)).toBeGreaterThanOrEqual(1);
      expect(bucket.deleted).toContain(staleRow.storageKey);
      expect(await db.$count(attachments, eq(attachments.id, stale.attachmentId))).toBe(0);
      expect(await db.$count(attachments, eq(attachments.id, fresh.attachmentId))).toBe(1);
      expect(await db.$count(attachments, eq(attachments.id, ready.id))).toBe(1);
      expect(await service(false).purgeStalePending(100)).toBe(0);
    });
  });
});
