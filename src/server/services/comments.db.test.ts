import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { type RichTextDoc } from "@/lib/rich-text";
import { comments, entityLinks } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createCommentService } from "./comments";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";

const doc = (text: string): RichTextDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describeDb("comment service (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let author: string;
  let someoneElse: string;
  let issueId: string;
  let targetKey: string;
  let targetId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    author = await createTestUser(db, "Author");
    someoneElse = await createTestUser(db, "Someone Else");
    const issues = createIssueService(db);
    const base = { projectKey: "STK", type: "task", priority: 2 } as const;
    issueId = (await issues.createIssue(author, { ...base, title: "Commented" })).id;
    const target = await issues.createIssue(author, { ...base, title: "Mentioned" });
    targetKey = target.key;
    targetId = target.id;
  });

  afterAll(async () => {
    await testDb?.close();
  });

  const service = () => createCommentService(db);
  const mentionTargets = async (commentId: string) =>
    (
      await db
        .select({ toId: entityLinks.toId })
        .from(entityLinks)
        .where(and(eq(entityLinks.fromType, "comment"), eq(entityLinks.fromId, commentId)))
    ).map((row) => row.toId);

  it("creates a comment, stores its plain text and links STK refs", async () => {
    const { id } = await service().createComment(author, {
      issueId,
      body: doc(`Repro'd, see ${targetKey}`),
    });
    const [row] = await db.select().from(comments).where(eq(comments.id, id));
    expect(row).toMatchObject({ authorId: author, bodyText: `Repro'd, see ${targetKey}` });
    expect(await mentionTargets(id)).toEqual([targetId]);
    const mentioned = await createIssueQueries(db).listMentionedIn(targetId);
    expect(mentioned).toEqual([expect.objectContaining({ sourceKind: "comment" })]);
  });

  it("lets only the author edit, and resyncs mentions on edit", async () => {
    const { id } = await service().createComment(author, { issueId, body: doc(targetKey) });

    await expect(
      service().editComment(someoneElse, { commentId: id, body: doc("hijacked") }),
    ).rejects.toThrow("You can only change your own comments");
    const [unchanged] = await db.select().from(comments).where(eq(comments.id, id));
    expect(unchanged?.bodyText).toBe(targetKey);
    expect(unchanged?.editedAt).toBeNull();

    await service().editComment(author, { commentId: id, body: doc("no refs now") });
    const [edited] = await db.select().from(comments).where(eq(comments.id, id));
    expect(edited?.bodyText).toBe("no refs now");
    expect(edited?.editedAt).toBeInstanceOf(Date);
    expect(await mentionTargets(id)).toEqual([]);
  });

  it("lets only the author delete (soft), then hides it", async () => {
    const { id } = await service().createComment(author, { issueId, body: doc(targetKey) });
    await expect(service().deleteComment(someoneElse, id)).rejects.toThrow(
      "You can only change your own comments",
    );
    await service().deleteComment(author, id);
    const [row] = await db.select().from(comments).where(eq(comments.id, id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(await mentionTargets(id)).toEqual([]);
    expect((await service().listForIssue(issueId)).map((c) => c.id)).not.toContain(id);
    await expect(service().deleteComment(author, id)).rejects.toThrow("Comment not found");
    await expect(service().editComment(author, { commentId: id, body: doc("x") })).rejects.toThrow(
      "Comment not found",
    );
  });

  it("refuses comments on a missing or deleted issue", async () => {
    const issues = createIssueService(db);
    const doomed = await issues.createIssue(author, {
      projectKey: "STK",
      title: "Doomed",
      type: "task",
      priority: 2,
    });
    await issues.deleteIssue(author, doomed.id);
    await expect(
      service().createComment(author, { issueId: doomed.id, body: doc("hello") }),
    ).rejects.toThrow("Issue not found");
  });
});
