import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";

import { activity, entityLinks, issues, projects, statuses } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { ServiceError } from "./errors";
import { createIssueQueries } from "./issue-queries";
import { createIssueService, type CreateIssueData } from "./issues";
import { rowsOf } from "./sql";

/** Real Postgres (HQ_DB_TESTS=1): the guarantees live in SQL, so they are tested in SQL. */
describeDb("issue service (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  const service = () => createIssueService(db);
  const queries = () => createIssueQueries(db);

  const create = (overrides: Partial<CreateIssueData> = {}) =>
    service().createIssue(actor, {
      projectKey: "STK",
      title: "Something",
      type: "task",
      priority: 2,
      ...overrides,
    });

  async function statusId(name: string): Promise<string> {
    const [row] = await db
      .select({ id: statuses.id })
      .from(statuses)
      .innerJoin(projects, eq(projects.id, statuses.projectId))
      .where(and(eq(projects.key, "STK"), eq(statuses.name, name)));
    if (!row) throw new Error(`no status ${name}`);
    return row.id;
  }

  async function issueRow(id: string) {
    const [row] = await db.select().from(issues).where(eq(issues.id, id));
    if (!row) throw new Error("issue missing");
    return row;
  }

  async function activityFor(id: string) {
    return db
      .select()
      .from(activity)
      .where(and(eq(activity.entityType, "issue"), eq(activity.entityId, id)))
      .orderBy(activity.createdAt);
  }

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("allocates unique, gapless numbers under concurrent creates", async () => {
    const [before] = await db
      .select({ counter: projects.issueCounter })
      .from(projects)
      .where(eq(projects.key, "STK"));
    // Every creator reads the same top rank before any insert lands, forcing the worst case:
    // all but one collide on rank and must retry.
    let waiting = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const racing = createIssueService(db, {
      beforeInsert: async () => {
        waiting += 1;
        if (waiting === 12) release();
        await gate;
      },
    });
    const created = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        racing.createIssue(actor, {
          projectKey: "STK",
          title: `Concurrent ${i}`,
          type: "task",
          priority: 2,
        }),
      ),
    );
    const start = before?.counter ?? 0;
    // More insert attempts than issues: the rank collisions really happened and were retried.
    expect(waiting).toBeGreaterThan(12);
    const numbers = created.map((issue) => issue.number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => start + i + 1));
    expect(new Set(created.map((issue) => issue.key)).size).toBe(12);

    const rows = await db.select({ rank: issues.rank, number: issues.number }).from(issues);
    expect(new Set(rows.map((row) => row.rank)).size).toBe(rows.length);
    const [after] = await db
      .select({ counter: projects.issueCounter })
      .from(projects)
      .where(eq(projects.key, "STK"));
    expect(after?.counter).toBe(start + 12);
  });

  it("puts new issues at the top of the backlog and uses the type's default status", async () => {
    const task = await create({ title: "Task first" });
    const bug = await create({ title: "Bug second", type: "bug" });
    const [taskRow, bugRow] = await Promise.all([issueRow(task.id), issueRow(bug.id)]);
    // Bytewise (C collation) order, like the column.
    expect(Buffer.compare(Buffer.from(bugRow.rank), Buffer.from(taskRow.rank))).toBe(-1);
    expect(taskRow.statusId).toBe(await statusId("Backlog"));
    expect(bugRow.statusId).toBe(await statusId("Triage"));
    expect(taskRow.reporterId).toBe(actor);
    expect((await activityFor(task.id)).map((row) => row.action)).toEqual(["created"]);
  });

  it("records from → to activity for each field change, and nothing for a no-op", async () => {
    const issue = await create({ title: "Old title", priority: 2 });
    await service().updateIssueField(actor, {
      issueId: issue.id,
      field: "title",
      value: "New title",
    });
    await service().updateIssueField(actor, { issueId: issue.id, field: "priority", value: 0 });
    const noop = await service().updateIssueField(actor, {
      issueId: issue.id,
      field: "priority",
      value: 0,
    });
    expect(noop.changed).toBe(false);
    await service().updateIssueField(actor, {
      issueId: issue.id,
      field: "assignee",
      value: actor,
    });
    await service().updateIssueField(actor, {
      issueId: issue.id,
      field: "storyPoints",
      value: 5,
    });
    await service().updateIssueField(actor, {
      issueId: issue.id,
      field: "dueDate",
      value: "2026-06-15",
    });

    const rows = (await activityFor(issue.id)).filter((row) => row.action === "updated");
    expect(rows.map((row) => [row.field, row.fromValue, row.toValue, row.actorId])).toEqual([
      ["title", "Old title", "New title", actor],
      ["priority", "2", "0", actor],
      ["assignee", null, actor, actor],
      ["storyPoints", null, "5", actor],
      ["dueDate", null, "2026-06-15", actor],
    ]);
    const row = await issueRow(issue.id);
    expect(row).toMatchObject({ title: "New title", priority: 0, storyPoints: 5 });
    expect(row.dueDate).toBe("2026-06-15");
  });

  it("sets resolved_at entering done, keeps it between done statuses, clears it leaving", async () => {
    const issue = await create();
    const set = (name: string) =>
      statusId(name).then((value) =>
        service().updateIssueField(actor, { issueId: issue.id, field: "status", value }),
      );

    await set("In Progress");
    expect((await issueRow(issue.id)).resolvedAt).toBeNull();

    await set("Done");
    const resolved = (await issueRow(issue.id)).resolvedAt;
    expect(resolved).toBeInstanceOf(Date);

    await set("Won't Do");
    expect((await issueRow(issue.id)).resolvedAt).toEqual(resolved);

    await set("Todo");
    expect((await issueRow(issue.id)).resolvedAt).toBeNull();

    const statusChanges = (await activityFor(issue.id)).filter((row) => row.field === "status");
    expect(statusChanges).toHaveLength(4);
    expect(statusChanges[1]?.toValue).toBe(await statusId("Done"));
  });

  it("rejects a status from another project", async () => {
    const issue = await create();
    const [other] = await db
      .insert(projects)
      .values({ key: "OTH", name: "Other" })
      .returning({ id: projects.id });
    const [foreign] = await db
      .insert(statuses)
      .values({ projectId: other?.id ?? "", name: "Open", category: "todo", position: 0 })
      .returning({ id: statuses.id });
    await expect(
      service().updateIssueField(actor, {
        issueId: issue.id,
        field: "status",
        value: foreign?.id ?? "",
      }),
    ).rejects.toThrow("Status not found");
  });

  it("enforces ISS-3 parent rules on create and on change", async () => {
    const epic = await create({ type: "epic", title: "Epic" });
    const story = await create({ type: "story", title: "Story", parentId: epic.id });
    const subtask = await create({ type: "subtask", title: "Sub", parentId: story.id });
    expect((await issueRow(subtask.id)).parentId).toBe(story.id);

    await expect(create({ type: "subtask", title: "Orphan" })).rejects.toThrow(
      "A subtask needs a parent issue",
    );
    await expect(create({ type: "subtask", parentId: epic.id })).rejects.toThrow(
      "cannot be an epic",
    );
    await expect(create({ type: "task", parentId: story.id })).rejects.toThrow(
      "parent must be an epic",
    );
    await expect(create({ type: "epic", parentId: epic.id })).rejects.toThrow(
      "An epic cannot have a parent",
    );
    await expect(
      service().updateIssueField(actor, { issueId: subtask.id, field: "parent", value: null }),
    ).rejects.toBeInstanceOf(ServiceError);
    await expect(
      service().updateIssueField(actor, { issueId: epic.id, field: "parent", value: epic.id }),
    ).rejects.toThrow("An epic cannot have a parent");

    const otherEpic = await create({ type: "epic", title: "Epic 2" });
    await service().updateIssueField(actor, {
      issueId: story.id,
      field: "parent",
      value: otherEpic.id,
    });
    const change = (await activityFor(story.id)).find((row) => row.field === "parent");
    expect(change).toMatchObject({ fromValue: epic.id, toValue: otherEpic.id });
  });

  it("adds and removes labels with activity, creating each label once", async () => {
    const a = await create();
    const b = await create();
    const first = await service().addLabel(actor, { issueId: a.id, name: "memory" });
    const second = await service().addLabel(actor, { issueId: b.id, name: "memory" });
    expect(second.labelId).toBe(first.labelId);
    // Adding again is a no-op, not a second activity row.
    await service().addLabel(actor, { issueId: a.id, name: "memory" });

    const detail = await queries().getIssue((await issueRow(a.id)).projectId, a.number);
    expect(detail?.labels.map((label) => label.name)).toEqual(["memory"]);

    await service().removeLabel(actor, { issueId: a.id, labelId: first.labelId });
    const rows = await activityFor(a.id);
    expect(rows.map((row) => row.action)).toEqual(["created", "label_added", "label_removed"]);
    expect(rows[2]?.meta).toEqual({ name: "memory" });
  });

  it("shows links from both ends with the inverse wording", async () => {
    const blocker = await create({ title: "Blocker" });
    const blocked = await create({ title: "Blocked" });
    const dup = await create({ title: "Dup" });

    await service().addLink(actor, {
      issueId: blocked.id,
      relation: "is_blocked_by",
      targetKey: blocker.key,
    });
    await service().addLink(actor, {
      issueId: dup.id,
      relation: "duplicates",
      targetKey: blocked.key.toLowerCase(),
    });
    await service().addLink(actor, {
      issueId: blocker.id,
      relation: "relates",
      targetKey: dup.key,
    });
    // "relates" is symmetric, so the reverse is a duplicate link.
    await expect(
      service().addLink(actor, { issueId: dup.id, relation: "relates", targetKey: blocker.key }),
    ).rejects.toThrow("already linked");
    await expect(
      service().addLink(actor, { issueId: dup.id, relation: "blocks", targetKey: dup.key }),
    ).rejects.toThrow("cannot link to itself");

    const view = async (id: string) =>
      (await queries().listLinks(id)).map((link) => [link.relation, link.issue.key]).sort();
    expect(await view(blocker.id)).toEqual([
      ["blocks", blocked.key],
      ["relates", dup.key],
    ]);
    expect(await view(blocked.id)).toEqual([
      ["is_blocked_by", blocker.key],
      ["is_duplicated_by", dup.key],
    ]);
    expect(await view(dup.id)).toEqual([
      ["duplicates", blocked.key],
      ["relates", blocker.key],
    ]);

    const [link] = await queries().listLinks(blocked.id);
    if (!link) throw new Error("no link");
    await service().removeLink(actor, { issueId: blocked.id, linkId: link.linkId });
    const blockerActivity = (await activityFor(blocker.id)).filter((row) => row.field === "links");
    expect(blockerActivity.map((row) => [row.action, row.meta])).toContainEqual([
      "link_removed",
      { relation: expect.any(String) },
    ]);
  });

  it("lists subtasks as children of their parent", async () => {
    const story = await create({ type: "story", title: "Parent" });
    const sub = await create({ type: "subtask", title: "Child", parentId: story.id });
    const children = await queries().listChildren(story.id);
    expect(children.map((child) => child.key)).toEqual([sub.key]);
  });

  it("links STK refs in descriptions and keeps them in sync", async () => {
    const target = await create({ title: "Target" });
    const other = await create({ title: "Other" });
    const doc = (text: string) => ({
      type: "doc" as const,
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const source = await create({ description: doc(`See ${target.key} and STK-999999`) });
    const mentionTargets = async () =>
      (
        await db
          .select({ toId: entityLinks.toId })
          .from(entityLinks)
          .where(and(eq(entityLinks.fromId, source.id), eq(entityLinks.origin, "mention")))
      ).map((row) => row.toId);
    expect(await mentionTargets()).toEqual([target.id]);
    expect((await queries().listMentionedIn(target.id)).map((m) => m.issue.key)).toEqual([
      source.key,
    ]);

    await service().updateIssueField(actor, {
      issueId: source.id,
      field: "description",
      value: doc(`Now ${other.key}`),
    });
    expect(await mentionTargets()).toEqual([other.id]);
    const descriptionChange = (await activityFor(source.id)).find(
      (row) => row.field === "description",
    );
    expect(descriptionChange).toMatchObject({ fromValue: null, toValue: null });
    expect((await issueRow(source.id)).descriptionText).toBe(`Now ${other.key}`);
  });

  it("soft-deletes an issue: hidden from reads, kept in the table", async () => {
    const issue = await create({ title: "Doomed" });
    const projectId = (await issueRow(issue.id)).projectId;
    await service().deleteIssue(actor, issue.id);
    expect((await issueRow(issue.id)).deletedAt).toBeInstanceOf(Date);
    expect(await queries().getIssue(projectId, issue.number)).toBeNull();
    expect((await queries().listIssues(projectId)).map((row) => row.id)).not.toContain(issue.id);
    await expect(service().deleteIssue(actor, issue.id)).rejects.toThrow("Issue not found");
    await expect(
      service().updateIssueField(actor, { issueId: issue.id, field: "title", value: "x" }),
    ).rejects.toThrow("Issue not found");
  });

  it("finds issues through the generated search column", async () => {
    await create({ title: "Scheduled outbox dispatch retries" });
    const result = rowsOf(
      await db.execute(
        // The search column is generated by Postgres, never written by the app.
        sql`SELECT title FROM issues WHERE search @@ websearch_to_tsquery('english', 'outbox')`,
      ),
      z.object({ title: z.string() }),
    );
    expect(result.map((row) => row.title)).toContain("Scheduled outbox dispatch retries");
  });
});
