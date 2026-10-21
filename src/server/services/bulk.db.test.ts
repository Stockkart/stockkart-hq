import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { BULK_MAX, bulkEditInput } from "@/lib/issues/bulk";
import { activity, issueLabels, issues, projects, statuses, watchers } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { type BulkEditData, createBulkService } from "./bulk";
import { createIssueService } from "./issues";
import { type Notify } from "./notifications";
import { createSprintService } from "./sprints";

/** ISS-12 against real Postgres (HQ_DB_TESTS=1): atomicity and validation live in SQL. */
describeDb("bulk edit (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let other: string;
  const notify = vi.fn<Notify>(async () => ({ created: 0 }));
  const service = () => createBulkService(db, { notify });
  const issueService = () => createIssueService(db, { runAtomic: transactionRunner(db) });

  const create = async (title: string, projectKey = "STK") =>
    (await issueService().createIssue(actor, { projectKey, title, type: "task", priority: 2 })).id;

  async function statusId(name: string): Promise<string> {
    const [row] = await db
      .select({ id: statuses.id })
      .from(statuses)
      .innerJoin(projects, eq(projects.id, statuses.projectId))
      .where(and(eq(projects.key, "STK"), eq(statuses.name, name)));
    if (!row) throw new Error(`no status ${name}`);
    return row.id;
  }

  const rows = (ids: string[]) => db.select().from(issues).where(inArray(issues.id, ids));
  const activityOf = (ids: string[], field?: string) =>
    db
      .select()
      .from(activity)
      .where(
        and(
          eq(activity.entityType, "issue"),
          inArray(activity.entityId, ids),
          field ? eq(activity.field, field) : undefined,
        ),
      );

  const edit = (issueIds: string[], change: BulkEditData["change"]) =>
    service().bulkEdit(actor, { projectKey: "STK", issueIds, change });

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
    other = await createTestUser(db, "Bo Other");
    // A second project, to prove ids of another project refuse the batch.
    const [otherProject] = await db
      .insert(projects)
      .values({ key: "OPS", name: "Ops" })
      .returning({ id: projects.id });
    if (!otherProject) throw new Error("no project");
    await db.insert(statuses).values([
      { projectId: otherProject.id, name: "Backlog", category: "todo", position: 0 },
      { projectId: otherProject.id, name: "Done", category: "done", position: 1 },
    ]);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("sets the status of every issue with one activity row each (burndown fields)", async () => {
    const ids = [await create("A"), await create("B"), await create("C")];
    const done = await statusId("Done");
    expect(await edit(ids, { kind: "status", statusId: done })).toEqual({ changed: 3 });
    for (const row of await rows(ids)) {
      expect(row.statusId).toBe(done);
      expect(row.resolvedAt).not.toBeNull();
    }
    const entries = await activityOf(ids, "status");
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((e) => e.entityId))).toEqual(new Set(ids));
    expect(entries.every((e) => e.action === "updated" && e.toValue === done)).toBe(true);

    // Unchanged values write nothing.
    expect(await edit(ids, { kind: "status", statusId: done })).toEqual({ changed: 0 });
    expect(await activityOf(ids, "status")).toHaveLength(3);
  });

  it("sets priority, assignee (auto-watch, notify) and sprint", async () => {
    const ids = [await create("P1"), await create("P2")];
    await edit(ids, { kind: "priority", priority: 0 });
    expect((await rows(ids)).every((row) => row.priority === 0)).toBe(true);
    expect(await activityOf(ids, "priority")).toHaveLength(2);

    notify.mockClear();
    await edit(ids, { kind: "assignee", assigneeId: other });
    expect((await rows(ids)).every((row) => row.assigneeId === other)).toBe(true);
    const assigned = await activityOf(ids, "assignee");
    expect(assigned.map((e) => e.toValue)).toEqual([other, other]);
    const watching = await db.select().from(watchers).where(inArray(watchers.issueId, ids));
    expect(watching.filter((w) => w.userId === other)).toHaveLength(2);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[0]?.[0]).toMatchObject({
      type: "assigned",
      recipients: [other],
      actorId: actor,
    });

    const sprintService = createSprintService(db, { runAtomic: transactionRunner(db) });
    const { id: sprintId } = await sprintService.createSprint(actor, {
      projectKey: "STK",
      name: "Sprint 1",
      goal: null,
      startDate: "2026-06-01",
      endDate: "2026-06-14",
    });
    await edit(ids, { kind: "sprint", sprintId });
    expect((await rows(ids)).every((row) => row.sprintId === sprintId)).toBe(true);
    expect(await activityOf(ids, "sprint")).toHaveLength(2);
    await edit(ids, { kind: "sprint", sprintId: null });
    expect((await rows(ids)).every((row) => row.sprintId === null)).toBe(true);
  });

  it("adds and removes labels, one activity row per issue and label", async () => {
    const ids = [await create("L1"), await create("L2")];
    await issueService().addLabel(actor, { issueId: ids[0] ?? "", name: "api" });
    await issueService().addLabel(actor, { issueId: ids[0] ?? "", name: "ui" });
    const labelRows = await db
      .select()
      .from(issueLabels)
      .where(eq(issueLabels.issueId, ids[0] ?? ""));
    const labelIds = labelRows.map((row) => row.labelId);

    // L1 already has both: only L2 gets them (2 rows of activity, not 4).
    expect(await edit(ids, { kind: "addLabels", labelIds })).toEqual({ changed: 2 });
    expect(
      await db.select().from(issueLabels).where(inArray(issueLabels.issueId, ids)),
    ).toHaveLength(4);
    expect(await edit(ids, { kind: "removeLabels", labelIds })).toEqual({ changed: 4 });
    expect(
      await db.select().from(issueLabels).where(inArray(issueLabels.issueId, ids)),
    ).toHaveLength(0);
    const removed = (await activityOf(ids, "labels")).filter((e) => e.action === "label_removed");
    expect(removed).toHaveLength(4);
  });

  it("deletes (soft) with an activity row each", async () => {
    const ids = [await create("D1"), await create("D2")];
    expect(await edit(ids, { kind: "delete" })).toEqual({ changed: 2 });
    expect((await rows(ids)).every((row) => row.deletedAt !== null)).toBe(true);
    const deleted = (await activityOf(ids)).filter((e) => e.action === "deleted");
    expect(deleted).toHaveLength(2);
  });

  it("refuses the whole batch for an id of another project, a deleted or unknown issue", async () => {
    const good = [await create("G1"), await create("G2")];
    const foreign = await create("Theirs", "OPS");
    const trashed = await create("Trashed");
    await issueService().deleteIssue(actor, trashed);
    for (const bad of [foreign, trashed, crypto.randomUUID()]) {
      await expect(edit([...good, bad], { kind: "priority", priority: 1 })).rejects.toMatchObject({
        code: "invalid",
      });
    }
    expect((await rows(good)).every((row) => row.priority === 2)).toBe(true);
    expect(await activityOf(good, "priority")).toHaveLength(0);
    // The other project's issue is untouched too.
    expect((await rows([foreign]))[0]?.priority).toBe(2);
  });

  it("refuses a status, sprint or label of another project", async () => {
    const ids = [await create("X1")];
    const [opsDone] = await db
      .select({ id: statuses.id })
      .from(statuses)
      .innerJoin(projects, eq(projects.id, statuses.projectId))
      .where(and(eq(projects.key, "OPS"), eq(statuses.name, "Done")));
    await expect(edit(ids, { kind: "status", statusId: opsDone?.id ?? "" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      edit(ids, { kind: "sprint", sprintId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      edit(ids, { kind: "addLabels", labelIds: [crypto.randomUUID()] }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("is atomic at write time: an issue deleted after the checks refuses everything", async () => {
    const ids = [await create("R1"), await create("R2")];
    // The checks are two reads (project, live count; a priority has no target to check).
    // Once both have answered, delete one of the issues, before the write runs.
    let answered = 0;
    const racing = createBulkService(db, {
      read: async (query) => {
        const result = await query;
        answered += 1;
        if (answered === 2) {
          await db
            .update(issues)
            .set({ deletedAt: new Date() })
            .where(eq(issues.id, ids[1] ?? ""));
        }
        return result;
      },
    });
    await expect(
      racing.bulkEdit(actor, {
        projectKey: "STK",
        issueIds: ids,
        change: { kind: "priority", priority: 0 },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await rows([ids[0] ?? ""]))[0]?.priority).toBe(2);
    expect(await activityOf(ids, "priority")).toHaveLength(0);
  });

  it(`takes at most ${BULK_MAX} ids and de-duplicates them`, () => {
    const many = Array.from({ length: BULK_MAX + 1 }, () => crypto.randomUUID());
    const base = { projectKey: "STK", change: { kind: "delete" } };
    expect(bulkEditInput.safeParse({ ...base, issueIds: many }).success).toBe(false);
    expect(bulkEditInput.safeParse({ ...base, issueIds: many.slice(0, BULK_MAX) }).success).toBe(
      true,
    );
    expect(bulkEditInput.safeParse({ ...base, issueIds: [] }).success).toBe(false);
    const id = crypto.randomUUID();
    expect(bulkEditInput.parse({ ...base, issueIds: [id, id] }).issueIds).toEqual([id]);
  });

  it(`edits ${BULK_MAX} issues in one go`, async () => {
    const ids: string[] = [];
    for (let i = 0; i < BULK_MAX; i += 1) ids.push(await create(`Many ${i}`));
    expect(await edit(ids, { kind: "priority", priority: 3 })).toEqual({ changed: BULK_MAX });
    expect(await activityOf(ids, "priority")).toHaveLength(BULK_MAX);
  });
});
