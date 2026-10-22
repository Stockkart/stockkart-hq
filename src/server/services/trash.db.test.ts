import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { activity, docs, issues } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createDocService } from "./docs";
import { createIssueService } from "./issues";
import { createPlanningService } from "./planning";
import { createSprintQueries } from "./sprint-queries";
import { createSprintService } from "./sprints";
import { projectIdByKey } from "./sql";
import { createTrashService } from "./trash";

/** ISS-13 against real Postgres (HQ_DB_TESTS=1). */
describeDb("trash (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  const runAtomic = () => transactionRunner(db);
  const trash = () => createTrashService(db, { runAtomic: runAtomic() });
  const issueService = () => createIssueService(db, { runAtomic: runAtomic() });
  const docService = () => createDocService(db, { runAtomic: runAtomic() });

  const create = (title: string, extra: { type?: "epic" | "task"; parentId?: string } = {}) =>
    issueService().createIssue(actor, {
      projectKey: "STK",
      title,
      type: extra.type ?? "task",
      priority: 2,
      parentId: extra.parentId,
    });

  async function issueRow(id: string) {
    const [row] = await db.select().from(issues).where(eq(issues.id, id));
    if (!row) throw new Error("issue missing");
    return row;
  }

  const ageBy = (table: "issues" | "docs", id: string, days: number) =>
    db.execute(
      sql`UPDATE ${sql.identifier(table)} SET deleted_at = now() - make_interval(days => ${days})
        WHERE id = ${id}::uuid`,
    );

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("lists issues and docs deleted in the last 30 days, newest first", async () => {
    const recent = await create("Recent");
    const old = await create("Old");
    const live = await create("Live");
    await issueService().deleteIssue(actor, recent.id);
    await issueService().deleteIssue(actor, old.id);
    await ageBy("issues", old.id, 31);
    const doc = await docService().createDoc(actor, {
      projectKey: "STK",
      title: "Gone page",
      type: "page",
    });
    await docService().deleteDoc(actor, doc.id);

    const list = await trash().listTrash(projectIdByKey("STK"));
    const ids = list.issues.map((item) => item.id);
    expect(ids).toContain(recent.id);
    expect(ids).not.toContain(old.id);
    expect(ids).not.toContain(live.id);
    expect(list.issues.find((item) => item.id === recent.id)).toMatchObject({
      key: recent.key,
      deletedBy: "Ada Actor",
      parentDeleted: false,
    });
    expect(list.docs.map((item) => item.id)).toEqual([doc.id]);

    // Older than 30 days: hidden and not restorable, but still in the table (not purged).
    await expect(trash().restoreIssue(actor, "STK", old.id)).rejects.toMatchObject({
      code: "not_found",
    });
    expect((await issueRow(old.id)).deletedAt).not.toBeNull();
  });

  it("restores an issue with an activity row", async () => {
    const issue = await create("Bring me back");
    await issueService().deleteIssue(actor, issue.id);
    expect(await trash().restoreIssue(actor, "STK", issue.id)).toEqual({
      detachedFromParent: false,
      key: issue.key,
    });
    expect((await issueRow(issue.id)).deletedAt).toBeNull();
    const restored = await db
      .select()
      .from(activity)
      .where(and(eq(activity.entityId, issue.id), eq(activity.action, "restored")));
    expect(restored).toHaveLength(1);
    // A live issue is not in the trash.
    await expect(trash().restoreIssue(actor, "STK", issue.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("restores an issue whose parent is deleted without its parent, with a note", async () => {
    const epic = await create("Epic", { type: "epic" });
    const child = await create("Child", { parentId: epic.id });
    await issueService().deleteIssue(actor, child.id);
    await issueService().deleteIssue(actor, epic.id);
    const list = await trash().listTrash(projectIdByKey("STK"));
    expect(list.issues.find((item) => item.id === child.id)?.parentDeleted).toBe(true);

    expect(await trash().restoreIssue(actor, "STK", child.id)).toEqual({
      detachedFromParent: true,
      key: child.key,
    });
    const row = await issueRow(child.id);
    expect(row).toMatchObject({ deletedAt: null, parentId: null });
    const [note] = await db
      .select()
      .from(activity)
      .where(and(eq(activity.entityId, child.id), eq(activity.field, "parent")));
    expect(note).toMatchObject({ fromValue: epic.id, toValue: null });
    expect(note?.meta).toMatchObject({ reason: "parent_deleted" });

    // With the parent live, the child keeps it.
    await trash().restoreIssue(actor, "STK", epic.id);
    const other = await create("Other child", { parentId: epic.id });
    await issueService().deleteIssue(actor, other.id);
    expect(await trash().restoreIssue(actor, "STK", other.id)).toMatchObject({
      detachedFromParent: false,
    });
    expect((await issueRow(other.id)).parentId).toBe(epic.id);
  });

  it("restores a doc, at the top level when its parent page is deleted", async () => {
    const parent = await docService().createDoc(actor, {
      projectKey: "STK",
      title: "Parent",
      type: "page",
    });
    const child = await docService().createDoc(actor, {
      projectKey: "STK",
      title: "Child page",
      type: "page",
      parentId: parent.id,
    });
    await docService().deleteDoc(actor, child.id);
    await docService().deleteDoc(actor, parent.id);
    expect(await trash().restoreDoc(actor, "STK", child.id)).toEqual({
      detachedFromParent: true,
      key: null,
    });
    const [row] = await db.select().from(docs).where(eq(docs.id, child.id));
    expect(row).toMatchObject({ deletedAt: null, parentId: null });
  });

  it("hands the delete and restore to the burndown replay (SPR-3)", async () => {
    const sprintService = createSprintService(db, { runAtomic: runAtomic() });
    const { id: sprintId } = await sprintService.createSprint(actor, {
      projectKey: "STK",
      name: "Sprint T",
      goal: null,
      startDate: "2026-06-01",
      endDate: "2026-06-14",
    });
    const issue = await create("In and out of the trash");
    await createPlanningService(db).moveIssueToSprint(actor, { issueId: issue.id, sprintId });
    await issueService().deleteIssue(actor, issue.id);
    await trash().restoreIssue(actor, "STK", issue.id);
    const queries = createSprintQueries(db);
    const { data } = await queries.burndownInputs(
      projectIdByKey("STK"),
      queries.oneSprint(projectIdByKey("STK"), sprintId),
    );
    const trashed = data.changes.filter(
      (change) => change.issueId === issue.id && change.field === "deleted",
    );
    expect(trashed.map((change) => [change.from, change.to]).sort()).toEqual([
      ["false", "true"],
      ["true", "false"],
    ]);
  });

  it("only restores items of the given project", async () => {
    const issue = await create("Wrong project");
    await issueService().deleteIssue(actor, issue.id);
    await expect(trash().restoreIssue(actor, "OPS", issue.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
