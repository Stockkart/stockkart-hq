import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { type RichTextDoc } from "@/lib/rich-text";
import { docs, notifications, projects } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createStorage } from "@/server/storage/storage";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createBulkService } from "./bulk";
import { createDiagramService } from "./diagrams";
import { createDocService } from "./docs";
import { createIssueService } from "./issues";
import { createMentionQueries } from "./mentions";
import { createNotificationService } from "./notifications";

/**
 * Where the P1 slices meet, against real Postgres (HQ_DB_TESTS=1): the settings slice's
 * bulk edit and default assignee with the real `notify()` of the notifications slice, and a
 * doc save carrying both an @mention (notifications) and a diagram embed (diagrams).
 */
describeDb("P1 slices together (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let ada: string;
  let bob: string;
  const issues = () => createIssueService(db, { runAtomic: transactionRunner(db) });
  // Wired as services/index.ts wires it: the real notify, not a fake.
  const bulk = () => createBulkService(db, { notify: createNotificationService(db).notify });
  const docService = () => createDocService(db, { runAtomic: transactionRunner(db) });
  const inbox = (userId: string, type: "assigned" | "mentioned_in_doc") =>
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.type, type)));
  const newIssue = async (title: string) =>
    (await issues().createIssue(ada, { projectKey: "STK", title, type: "task", priority: 2 })).id;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    ada = await createTestUser(db, "Ada");
    bob = await createTestUser(db, "Bob");
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("bulk assign notifies the new assignee once per issue, never the actor", async () => {
    const ids = [await newIssue("Bulk 1"), await newIssue("Bulk 2")];
    await bulk().bulkEdit(ada, {
      projectKey: "STK",
      issueIds: ids,
      change: { kind: "assignee", assigneeId: bob },
    });
    const toBob = (await inbox(bob, "assigned")).filter((row) => ids.includes(row.entityId));
    expect(toBob.map((row) => row.entityId).sort()).toEqual([...ids].sort());
    expect(toBob.every((row) => row.actorId === ada && row.entityType === "issue")).toBe(true);

    // Assigning to yourself writes no bell entry.
    await bulk().bulkEdit(ada, {
      projectKey: "STK",
      issueIds: ids,
      change: { kind: "assignee", assigneeId: ada },
    });
    const toAda = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ada), inArray(notifications.entityId, ids)));
    expect(toAda).toEqual([]);
  });

  it("a new issue that takes the project's default assignee notifies them (PRJ-3, NTF-1)", async () => {
    await db.update(projects).set({ defaultAssigneeId: bob }).where(eq(projects.key, "STK"));
    try {
      const id = await newIssue("Defaulted");
      expect((await inbox(bob, "assigned")).filter((row) => row.entityId === id)).toHaveLength(1);
    } finally {
      await db.update(projects).set({ defaultAssigneeId: null }).where(eq(projects.key, "STK"));
    }
  });

  it("a doc save with a diagram embed still syncs and notifies its @mentions", async () => {
    const diagram = await createDiagramService(db, {
      runAtomic: transactionRunner(db),
      storage: createStorage(null),
    }).createDiagram(ada, { projectKey: "STK", title: "Checkout flow", kind: "flow" });
    const doc = await docService().createDoc(ada, {
      projectKey: "STK",
      title: "Design",
      type: "page",
    });
    const content: RichTextDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Review with " },
            { type: "mention", attrs: { id: bob, label: "Bob" } },
          ],
        },
        {
          type: "diagramEmbed",
          attrs: { diagramId: diagram.id, title: "Checkout flow", projectKey: "STK", kind: "flow" },
        },
      ],
    };
    const saved = await docService().saveDoc(ada, {
      docId: doc.id,
      baseVersion: doc.version,
      content,
      snapshot: false,
    });
    expect(saved.status).toBe("saved");

    // The embed is kept and its title is searchable text.
    const [row] = await db.select().from(docs).where(eq(docs.id, doc.id));
    expect(JSON.stringify(row?.content)).toContain(`"diagramId":"${diagram.id}"`);
    expect(row?.contentText).toContain("Checkout flow");
    // The mention is linked (My Work "Mentions") and notified once.
    const mentions = await createMentionQueries(db).listMentionsOf(bob, 10);
    expect(mentions.some((item) => item.source === "doc" && item.mentionedByName === "Ada")).toBe(
      true,
    );
    expect(
      (await inbox(bob, "mentioned_in_doc")).filter((n) => n.entityId === doc.id),
    ).toHaveLength(1);
  });
});
