import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DIAGRAM_SCENE_MAX_BYTES } from "@/lib/diagrams/constants";
import { extractUserMentionIds } from "@/lib/mentions";
import { pgErrorInfo } from "@/server/services/errors";
import { createFileQueries } from "@/server/services/files";
import { createIssueService } from "@/server/services/issues";
import { rowsOf, userMentionAddedRow, userMentionSyncStatement } from "@/server/services/sql";
import { attachmentKey, diagramThumbnailKey } from "@/server/storage/keys";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import {
  activity,
  attachments,
  diagrams,
  diagramVersions,
  entityLinks,
  notifications,
  projects,
  savedViews,
  users,
  watchers,
} from "./schema";
import { seed } from "./seed";
import { type AppDatabase, transactionRunner } from "./types";

/** Constraint name of the Postgres error a write failed with. */
async function violation(write: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await write;
  } catch (error) {
    return pgErrorInfo(error)?.constraint ?? pgErrorInfo(error)?.code;
  }
  return undefined;
}

/** Migration 0004: the tables, columns and constraints the P1 slices build on (Postgres). */
describeDb("P1 foundation schema (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let alice: string;
  let bob: string;
  let projectId: string;
  let issueId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    alice = await createTestUser(db, "Alice");
    bob = await createTestUser(db, "Bob");
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, "STK"));
    if (!project) throw new Error("seed created no STK project");
    projectId = project.id;
    const issues = createIssueService(db, { runAtomic: transactionRunner(db) });
    issueId = (
      await issues.createIssue(alice, { projectKey: "STK", type: "task", priority: 2, title: "W" })
    ).id;
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("adds users.notify_email (off) and projects.default_assignee_id (null)", async () => {
    const [user] = await db
      .select({ notifyEmail: users.notifyEmail })
      .from(users)
      .where(eq(users.id, alice));
    expect(user?.notifyEmail).toBe(false);
    const [project] = await db
      .select({ defaultAssigneeId: projects.defaultAssigneeId })
      .from(projects)
      .where(eq(projects.id, projectId));
    expect(project?.defaultAssigneeId).toBeNull();
  });

  it("allows 'attachment' as an entity type", async () => {
    const id = randomUUID();
    await db
      .insert(activity)
      .values({ entityType: "attachment", entityId: id, action: "uploaded" });
    const [row] = await db.select().from(activity).where(eq(activity.entityId, id));
    expect(row?.entityType).toBe("attachment");
  });

  it("watchers: one row per issue and user, removed with the issue's user", async () => {
    await db.insert(watchers).values({ issueId, userId: bob });
    expect(await violation(db.insert(watchers).values({ issueId, userId: bob }))).toBe(
      "watchers_issue_id_user_id_pk",
    );
    const temp = await createTestUser(db, "Temp");
    await db.insert(watchers).values({ issueId, userId: temp });
    await db.delete(users).where(eq(users.id, temp));
    const rows = await db.select().from(watchers).where(eq(watchers.issueId, issueId));
    expect(rows.map((row) => row.userId)).toEqual([bob]);
  });

  it("notifications: a repeated dedupe key inserts nothing; null keys never collide", async () => {
    const base = {
      userId: bob,
      type: "assigned" as const,
      entityType: "issue" as const,
      entityId: issueId,
      actorId: alice,
    };
    const insert = (dedupeKey: string | null) =>
      db
        .insert(notifications)
        .values({ ...base, dedupeKey })
        .onConflictDoNothing({ target: notifications.dedupeKey })
        .returning({ id: notifications.id });
    expect(await insert("assigned:a1:bob")).toHaveLength(1);
    expect(await insert("assigned:a1:bob")).toHaveLength(0);
    expect(await insert(null)).toHaveLength(1);
    expect(await insert(null)).toHaveLength(1);
    const rows = await db.select().from(notifications).where(eq(notifications.userId, bob));
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.readAt === null)).toBe(true);
  });

  it("saved_views: names are unique per user and project", async () => {
    const view = { userId: alice, projectId, name: "Open P0/P1 bugs", filter: { type: ["bug"] } };
    await db.insert(savedViews).values({ ...view, position: "a0" });
    expect(await violation(db.insert(savedViews).values({ ...view, position: "a1" }))).toBe(
      "saved_views_user_project_name_unique",
    );
    await db.insert(savedViews).values({ ...view, userId: bob, position: "a0", shared: true });
  });

  it("attachments: unique storage key, size 1 B…10 MB, servable only when ready", async () => {
    const id = randomUUID();
    const key = attachmentKey("shot.png", id);
    const row = {
      id,
      entityType: "issue" as const,
      entityId: issueId,
      storageKey: key,
      filename: "shot.png",
      mime: "image/png",
      sizeBytes: 1000,
      uploadedBy: alice,
    };
    await db.insert(attachments).values(row);
    expect(await violation(db.insert(attachments).values({ ...row, id: randomUUID() }))).toBe(
      "attachments_storage_key_unique",
    );
    const other = { ...row, storageKey: attachmentKey("x.png") };
    expect(
      await violation(db.insert(attachments).values({ ...other, id: randomUUID(), sizeBytes: 0 })),
    ).toBe("attachments_size_range");
    expect(
      await violation(
        db
          .insert(attachments)
          .values({ ...other, id: randomUUID(), sizeBytes: 10 * 1024 * 1024 + 1 }),
      ),
    ).toBe("attachments_size_range");

    const files = createFileQueries(db);
    expect(await files.readyAttachment(id)).toBeNull();
    await db.update(attachments).set({ status: "ready" }).where(eq(attachments.id, id));
    expect(await files.readyAttachment(id)).toEqual({
      storageKey: key,
      filename: "shot.png",
      mime: "image/png",
    });
    await db.update(attachments).set({ deletedAt: new Date() }).where(eq(attachments.id, id));
    expect(await files.readyAttachment(id)).toBeNull();
  });

  describe("diagrams", () => {
    const newDiagram = (overrides: Partial<typeof diagrams.$inferInsert> = {}) =>
      db
        .insert(diagrams)
        .values({
          projectId,
          kind: "flow",
          title: "Stockkart system context",
          scene: { nodes: [], edges: [] },
          sceneText: "inventory-api postgres queue",
          ownerId: alice,
          position: "a0",
          ...overrides,
        })
        .returning({ id: diagrams.id, version: diagrams.version });

    it("starts at version 1 and is found by title and scene text", async () => {
      const [created] = await newDiagram();
      expect(created?.version).toBe(1);
      const hits = await db
        .select({ id: diagrams.id })
        .from(diagrams)
        .where(sql`${diagrams.search} @@ plainto_tsquery('english', 'postgres')`);
      expect(hits.map((hit) => hit.id)).toContain(created?.id);
    });

    it("refuses a scene of 2 MB or more", async () => {
      const big = { blob: "x".repeat(DIAGRAM_SCENE_MAX_BYTES) };
      expect(await violation(newDiagram({ scene: big }))).toBe("diagrams_scene_size");
    });

    it("keeps one snapshot per version and serves only saved thumbnails", async () => {
      const [created] = await newDiagram({ kind: "whiteboard" });
      if (!created) throw new Error("no diagram");
      const snapshot = {
        diagramId: created.id,
        version: 1,
        title: "v1",
        scene: { elements: [] },
        authorId: alice,
      };
      await db.insert(diagramVersions).values(snapshot);
      expect(await violation(db.insert(diagramVersions).values(snapshot))).toBe(
        "diagram_versions_diagram_version_unique",
      );

      const files = createFileQueries(db);
      expect(await files.diagramThumbnail(created.id)).toBeNull();
      const thumbnailKey = diagramThumbnailKey(created.id);
      await db.update(diagrams).set({ thumbnailKey }).where(eq(diagrams.id, created.id));
      expect(await files.diagramThumbnail(created.id)).toMatchObject({
        storageKey: thumbnailKey,
        mime: "image/png",
      });
      await db.update(diagrams).set({ deletedAt: new Date() }).where(eq(diagrams.id, created.id));
      expect(await files.diagramThumbnail(created.id)).toBeNull();
    });
  });

  it("syncs @user mention links and returns only the newly mentioned users", async () => {
    const commentLike = randomUUID();
    const sync = async (userIds: string[]) =>
      rowsOf(
        await db.execute(
          userMentionSyncStatement({
            fromType: "comment",
            fromId: commentLike,
            userIds,
            actorId: alice,
            gate: sql`TRUE`,
          }),
        ),
        userMentionAddedRow,
      ).map((row) => row.user_id);
    const linked = async () =>
      (
        await db
          .select({ toId: entityLinks.toId })
          .from(entityLinks)
          .where(
            and(
              eq(entityLinks.fromId, commentLike),
              eq(entityLinks.toType, "user"),
              eq(entityLinks.origin, "mention"),
            ),
          )
      )
        .map((row) => row.toId)
        .sort();

    const ids = extractUserMentionIds({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: bob, label: "Bob" } },
            { type: "mention", attrs: { id: "not-a-uuid", label: "x" } },
            { type: "mention", attrs: { id: randomUUID(), label: "Ghost" } },
          ],
        },
      ],
    });
    expect(await sync(ids)).toEqual([bob]);
    expect(await linked()).toEqual([bob]);
    // Bob again plus Alice: only Alice is new.
    expect(await sync([bob, alice])).toEqual([alice]);
    expect(await linked()).toEqual([alice, bob].sort());
    // Bob removed.
    expect(await sync([alice])).toEqual([]);
    expect(await linked()).toEqual([alice]);
  });
});
