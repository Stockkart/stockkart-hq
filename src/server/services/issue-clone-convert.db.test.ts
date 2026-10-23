import { and, eq, or } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rt } from "@/lib/rich-text";
import {
  activity,
  comments,
  components,
  githubRefs,
  issueLabels,
  issueLinks,
  issues,
} from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type Read } from "@/server/db/read-batch";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createCommentService } from "./comments";
import { createIssueService } from "./issues";

/** ISS-14 clone and convert, against real Postgres (HQ_DB_TESTS=1). */
describeDb("issue clone and convert (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  const service = () => createIssueService(db, { runAtomic: transactionRunner(db) });

  const create = (
    type: "epic" | "story" | "task" | "bug" | "subtask",
    title: string,
    parentId?: string,
  ) => service().createIssue(actor, { projectKey: "STK", title, type, priority: 1, parentId });

  const row = async (id: string) => {
    const [found] = await db.select().from(issues).where(eq(issues.id, id));
    if (!found) throw new Error("issue missing");
    return found;
  };
  const activityOf = (id: string) =>
    db
      .select({
        action: activity.action,
        field: activity.field,
        from: activity.fromValue,
        to: activity.toValue,
        meta: activity.meta,
      })
      .from(activity)
      .where(and(eq(activity.entityType, "issue"), eq(activity.entityId, id)))
      .orderBy(activity.createdAt);

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
  });

  afterAll(async () => {
    await testDb?.close();
  });

  describe("clone", () => {
    it("copies type, title, description, priority, component, labels, points and parent", async () => {
      const epic = await create("epic", "Payments");
      const source = await create("story", "Refund flow", epic.id);
      const [component] = await db
        .select({ id: components.id })
        .from(components)
        .where(eq(components.name, "inventory-api"));
      if (!component) throw new Error("no component");
      const description = rt.doc(rt.paragraph("See STK-1 for context"));
      const s = service();
      await s.updateIssueField(actor, {
        issueId: source.id,
        field: "description",
        value: description,
      });
      await s.updateIssueField(actor, {
        issueId: source.id,
        field: "component",
        value: component.id,
      });
      await s.updateIssueField(actor, { issueId: source.id, field: "storyPoints", value: 5 });
      await s.updateIssueField(actor, { issueId: source.id, field: "priority", value: 0 });
      await s.addLabel(actor, { issueId: source.id, name: "ocr" });
      await s.addLabel(actor, { issueId: source.id, name: "perf" });
      // Not copied: comments, links and GitHub refs.
      const other = await create("task", "Other");
      await s.addLink(actor, { issueId: source.id, relation: "blocks", targetKey: other.key });
      await createCommentService(db, { runAtomic: transactionRunner(db) }).createComment(actor, {
        issueId: source.id,
        body: rt.doc(rt.paragraph("A comment")),
      });
      await db.insert(githubRefs).values({
        issueId: source.id,
        kind: "branch",
        repo: "Stockkart/inventory-api",
        refName: `feature/${source.key}`,
        title: `feature/${source.key}`,
        url: `https://github.com/Stockkart/inventory-api/tree/feature/${source.key}`,
      });

      const clone = await s.cloneIssue(actor, { issueId: source.id });
      expect(clone.number).toBeGreaterThan(source.number);
      const copy = await row(clone.id);
      expect(copy).toMatchObject({
        type: "story",
        title: "Copy of Refund flow",
        description,
        descriptionText: "See STK-1 for context",
        priority: 0,
        componentId: component.id,
        storyPoints: 5,
        parentId: epic.id,
        sprintId: null,
      });
      const labels = await db
        .select({ labelId: issueLabels.labelId })
        .from(issueLabels)
        .where(eq(issueLabels.issueId, clone.id));
      expect(labels).toHaveLength(2);
      expect(await db.select().from(comments).where(eq(comments.entityId, clone.id))).toHaveLength(
        0,
      );
      expect(
        await db.select().from(githubRefs).where(eq(githubRefs.issueId, clone.id)),
      ).toHaveLength(0);

      // The only link of the clone: "relates" to the original.
      const links = await db
        .select({
          source: issueLinks.sourceIssueId,
          target: issueLinks.targetIssueId,
          type: issueLinks.type,
        })
        .from(issueLinks)
        .where(or(eq(issueLinks.sourceIssueId, clone.id), eq(issueLinks.targetIssueId, clone.id)));
      expect(links).toEqual([{ source: clone.id, target: source.id, type: "relates" }]);

      // Activity on both.
      const copyActivity = await activityOf(clone.id);
      expect(copyActivity).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "created",
            to: "story",
            meta: { clonedFromId: source.id, clonedFromKey: source.key },
          }),
          expect.objectContaining({ action: "link_added", field: "links", to: source.id }),
        ]),
      );
      const sourceActivity = await activityOf(source.id);
      expect(sourceActivity).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "cloned",
            field: "links",
            to: clone.id,
            meta: { cloneKey: clone.key },
          }),
          expect.objectContaining({ action: "link_added", field: "links", to: clone.id }),
        ]),
      );
      // The original is unchanged.
      expect(await row(source.id)).toMatchObject({ title: "Refund flow", storyPoints: 5 });
    });

    it("cuts a long title to the limit, and refuses a deleted issue", async () => {
      const long = await create("task", "x".repeat(255));
      const clone = await service().cloneIssue(actor, { issueId: long.id });
      expect((await row(clone.id)).title).toHaveLength(255);
      await service().deleteIssue(actor, long.id);
      await expect(service().cloneIssue(actor, { issueId: long.id })).rejects.toMatchObject({
        message: expect.stringMatching(/not found/i),
      });
    });
  });

  describe("convert type", () => {
    it("changes the type with a type activity row", async () => {
      const task = await create("task", "Convert me");
      const change = await service().convertIssueType(actor, { issueId: task.id, type: "bug" });
      expect(change).toEqual({ from: "task", to: "bug", changed: true });
      expect((await row(task.id)).type).toBe("bug");
      expect(await activityOf(task.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: "updated", field: "type", from: "task", to: "bug" }),
        ]),
      );
      // Same type: nothing changes, nothing is logged.
      expect(
        await service().convertIssueType(actor, { issueId: task.id, type: "bug" }),
      ).toMatchObject({ changed: false });
      expect((await activityOf(task.id)).filter((entry) => entry.field === "type")).toHaveLength(1);
    });

    it("blocks converting an epic that has children", async () => {
      const epic = await create("epic", "Parent epic");
      await create("story", "Child", epic.id);
      await expect(
        service().convertIssueType(actor, { issueId: epic.id, type: "story" }),
      ).rejects.toMatchObject({
        message: "This epic has 1 child issue; move it to another epic first",
      });
      expect((await row(epic.id)).type).toBe("epic");
    });

    it("blocks a subtask without a parent, and one under an epic", async () => {
      const free = await create("task", "No parent");
      await expect(
        service().convertIssueType(actor, { issueId: free.id, type: "subtask" }),
      ).rejects.toMatchObject({ message: "A subtask needs a parent issue; set one first" });
      const epic = await create("epic", "Some epic");
      const story = await create("story", "Under an epic", epic.id);
      await expect(
        service().convertIssueType(actor, { issueId: story.id, type: "subtask" }),
      ).rejects.toMatchObject({ message: expect.stringMatching(/cannot be an epic/) });
    });

    it("lets a subtask become a task only under an epic parent", async () => {
      const story = await create("story", "Story");
      const sub = await create("subtask", "Sub", story.id);
      await expect(
        service().convertIssueType(actor, { issueId: sub.id, type: "task" }),
      ).rejects.toMatchObject({ message: expect.stringMatching(/parent must be an epic/) });
      expect((await row(sub.id)).type).toBe("subtask");
    });

    it("refuses an issue with subtasks becoming an epic (the in-SQL child gate too)", async () => {
      const story = await create("story", "Has subtasks");
      await create("subtask", "Sub", story.id);
      await expect(
        service().convertIssueType(actor, { issueId: story.id, type: "epic" }),
      ).rejects.toMatchObject({ message: "Its subtasks need a non-epic parent; move them first" });
      expect((await row(story.id)).type).toBe("story");
    });

    it("re-checks the rules at write time (a child added after the check)", async () => {
      const epic = await create("epic", "Raced");
      const child = await create("story", "Late child");
      // The first read (the check) sees no child; a concurrent move then puts one under the
      // epic before the write. The write's own NOT EXISTS (after its row lock) sees it.
      let raced = false;
      const racingRead: Read = async (query) => {
        const result = await query;
        if (!raced) {
          raced = true;
          await db.update(issues).set({ parentId: epic.id }).where(eq(issues.id, child.id));
        }
        return result;
      };
      const racing = createIssueService(db, { runAtomic: transactionRunner(db), read: racingRead });
      await expect(
        racing.convertIssueType(actor, { issueId: epic.id, type: "task" }),
      ).rejects.toMatchObject({ message: expect.stringMatching(/child issue/) });
      expect((await row(epic.id)).type).toBe("epic");
    });
  });
});
