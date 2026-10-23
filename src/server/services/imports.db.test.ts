import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { IMPORT_MAX_ROWS } from "@/lib/imports/constants";
import { type ImportField } from "@/lib/imports/fields";
import {
  activity,
  imports,
  issueLabels,
  issues,
  labels,
  projects,
  statuses,
  users,
  watchers,
} from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { ServiceError } from "./errors";
import { createImportQueries, createImportService } from "./imports";
import { createIssueService } from "./issues";
import { projectIdByKey } from "./sql";

/** IMP-4 CSV import against real Postgres (synthetic data only, S-7). */
describeDb("CSV import of issues (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let assignee: string;
  let assigneeEmail: string;
  let projectId: string;
  const service = () => createImportService(db, { runAtomic: transactionRunner(db) });

  const fields: ImportField[] = [
    "title",
    "type",
    "priority",
    "status",
    "assignee",
    "labels",
    "points",
    "due_date",
    "description",
  ];

  const counter = async () => {
    const [row] = await db
      .select({ counter: projects.issueCounter })
      .from(projects)
      .where(eq(projects.id, projectId));
    return row?.counter ?? 0;
  };

  const importRow = async (id: string) => {
    const [row] = await db.select().from(imports).where(eq(imports.id, id));
    return row ?? null;
  };

  const expectError = async (promise: Promise<unknown>, code: string, message?: RegExp) => {
    const error = await promise.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ServiceError);
    if (error instanceof ServiceError) {
      expect(error.code).toBe(code);
      if (message) expect(error.message).toMatch(message);
    }
  };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Im Porter");
    assignee = await createTestUser(db, "Ada Assignee");
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, assignee));
    assigneeEmail = user?.email ?? "";
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, "STK"));
    if (!project) throw new Error("seed made no project");
    projectId = project.id;
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("previews every row, records the errors only, and applies the valid rows once", async () => {
    const rows = [
      [
        "Import one",
        "bug",
        "P0",
        "done",
        assigneeEmail,
        "Backend;csv-new",
        "3",
        "2026-06-30",
        "Line 1\nSee STK-1",
      ],
      ["Import two", "", "", "", "", "", "", "", ""],
      ["", "story", "P9", "Shipped", "nobody@example.test", "", "x", "2026-02-30", ""],
      ["Import three", "story", "1", "In Progress", "Ada Assignee", "csv-new", "", "", ""],
    ];
    const before = await counter();
    const preview = await service().preview(actor, {
      projectKey: "STK",
      filename: "issues.csv",
      fields,
      rows,
    });
    expect(preview).toMatchObject({ rowCount: 4, validCount: 3, invalidCount: 1 });
    expect(preview.errors.map((error) => [error.row, error.field])).toEqual([
      [4, "title"],
      [4, "priority"],
      [4, "status"],
      [4, "assignee"],
      [4, "points"],
      [4, "due_date"],
    ]);
    const previewed = await importRow(preview.importId);
    expect(previewed).toMatchObject({
      status: "previewed",
      rowCount: 4,
      createdCount: 0,
      errorCount: 1,
      appliedAt: null,
      filename: "issues.csv",
    });
    // The report holds row numbers and messages, never the rows themselves.
    const report = JSON.stringify(previewed?.report);
    expect(report).not.toContain("Import one");
    expect(report).not.toContain("Line 1");
    expect(await counter()).toBe(before);

    const applied = await service().apply(actor, { importId: preview.importId, fields, rows });
    expect(applied).toEqual({
      created: 3,
      skipped: 1,
      alreadyApplied: false,
      firstKey: `STK-${before + 1}`,
      lastKey: `STK-${before + 3}`,
    });
    expect(await counter()).toBe(before + 3);
    const created = await db
      .select({
        id: issues.id,
        number: issues.number,
        title: issues.title,
        type: issues.type,
        priority: issues.priority,
        statusName: statuses.name,
        assigneeId: issues.assigneeId,
        reporterId: issues.reporterId,
        storyPoints: issues.storyPoints,
        dueDate: issues.dueDate,
        descriptionText: issues.descriptionText,
        resolvedAt: issues.resolvedAt,
        rank: issues.rank,
      })
      .from(issues)
      .innerJoin(statuses, eq(statuses.id, issues.statusId))
      .where(and(eq(issues.projectId, projectId), sql`${issues.number} > ${before}`))
      .orderBy(asc(issues.number));
    expect(
      created.map((row) => [row.number, row.title, row.type, row.priority, row.statusName]),
    ).toEqual([
      [before + 1, "Import one", "bug", 0, "Done"],
      [before + 2, "Import two", "task", 2, "Backlog"],
      [before + 3, "Import three", "story", 1, "In Progress"],
    ]);
    const [one, two, three] = created;
    expect(one).toMatchObject({
      assigneeId: assignee,
      reporterId: actor,
      storyPoints: 3,
      dueDate: "2026-06-30",
      descriptionText: "Line 1\nSee STK-1",
    });
    // §4.4: imported straight into Done counts as resolved.
    expect(one?.resolvedAt).toBeInstanceOf(Date);
    expect(two?.resolvedAt).toBeNull();
    expect(three?.assigneeId).toBe(assignee);
    // CSV order on top of the backlog.
    const ranks = created.map((row) => row.rank);
    expect([...ranks].sort()).toEqual(ranks);

    // Labels (missing ones created), "created via CSV import" activity, watchers.
    const ids = created.map((row) => row.id);
    const attached = await db
      .select({ issueId: issueLabels.issueId, name: labels.name })
      .from(issueLabels)
      .innerJoin(labels, eq(labels.id, issueLabels.labelId))
      .where(inArray(issueLabels.issueId, ids));
    expect(
      attached
        .filter((row) => row.issueId === one?.id)
        .map((row) => row.name)
        .sort(),
    ).toEqual(["backend", "csv-new"]);
    expect(attached.filter((row) => row.issueId === three?.id).map((row) => row.name)).toEqual([
      "csv-new",
    ]);
    const createdRows = await db
      .select({ meta: activity.meta })
      .from(activity)
      .where(and(inArray(activity.entityId, ids), eq(activity.action, "created")));
    expect(createdRows).toHaveLength(3);
    for (const row of createdRows) {
      expect(row.meta).toEqual({
        source: "csv_import",
        importId: preview.importId,
        filename: "issues.csv",
      });
    }
    const watching = await db
      .select({ issueId: watchers.issueId, userId: watchers.userId })
      .from(watchers)
      .where(eq(watchers.issueId, one?.id ?? ""));
    expect(new Set(watching.map((row) => row.userId))).toEqual(new Set([actor, assignee]));

    expect(await importRow(preview.importId)).toMatchObject({
      status: "applied",
      createdCount: 3,
      errorCount: 1,
    });
    expect((await importRow(preview.importId))?.appliedAt).toBeInstanceOf(Date);

    // Re-applying the same import is a no-op that reports the first apply.
    await expect(
      service().apply(actor, { importId: preview.importId, fields, rows }),
    ).resolves.toEqual({
      created: 0,
      skipped: 1,
      alreadyApplied: true,
      firstKey: `STK-${before + 1}`,
      lastKey: `STK-${before + 3}`,
    });
    expect(await counter()).toBe(before + 3);

    const history = await createImportQueries(db).listImports(projectIdByKey("STK"));
    expect(history[0]).toMatchObject({
      id: preview.importId,
      status: "applied",
      rowCount: 4,
      createdCount: 3,
      errorCount: 1,
      createdByName: "Im Porter",
    });
  });

  it("applies once when submitted twice at the same time", async () => {
    const rows = [["Twice A"], ["Twice B"]];
    const before = await counter();
    const { importId } = await service().preview(actor, {
      projectKey: "STK",
      filename: "twice.csv",
      fields: ["title"],
      rows,
    });
    const results = await Promise.all([
      service().apply(actor, { importId, fields: ["title"], rows }),
      service().apply(actor, { importId, fields: ["title"], rows }),
    ]);
    expect(results.map((result) => result.alreadyApplied).sort()).toEqual([false, true]);
    expect(await counter()).toBe(before + 2);
    const made = await db
      .select({ id: issues.id })
      .from(issues)
      .where(inArray(issues.title, ["Twice A", "Twice B"]));
    expect(made).toHaveLength(2);
  });

  it("is all or nothing: a failure part-way creates no issue and keeps the import previewed", async () => {
    const rows = [
      ["Atomic A", "Backlog"],
      ["Atomic B", "Todo"],
    ];
    const { importId } = await service().preview(actor, {
      projectKey: "STK",
      filename: "atomic.csv",
      fields: ["title", "status"],
      rows,
    });
    const before = await counter();
    // A trigger that fails the second insert stands in for any error inside the statement.
    await db.execute(sql`
      CREATE FUNCTION fail_atomic_b() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.title = 'Atomic B' THEN RAISE EXCEPTION 'boom'; END IF;
        RETURN NEW;
      END $$
    `);
    await db.execute(sql`
      CREATE TRIGGER fail_atomic_b BEFORE INSERT ON issues
      FOR EACH ROW EXECUTE FUNCTION fail_atomic_b()
    `);
    try {
      await expect(
        service().apply(actor, { importId, fields: ["title", "status"], rows }),
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`DROP TRIGGER fail_atomic_b ON issues`);
      await db.execute(sql`DROP FUNCTION fail_atomic_b()`);
    }
    expect(await counter()).toBe(before);
    expect(
      await db.select({ id: issues.id }).from(issues).where(eq(issues.title, "Atomic A")),
    ).toHaveLength(0);
    expect(await importRow(importId)).toMatchObject({ status: "previewed", appliedAt: null });
    // And it still applies once the problem is gone.
    await expect(
      service().apply(actor, { importId, fields: ["title", "status"], rows }),
    ).resolves.toMatchObject({ created: 2 });
  });

  it("refuses an apply whose cells differ from the preview, or without valid rows", async () => {
    const { importId } = await service().preview(actor, {
      projectKey: "STK",
      filename: "changed.csv",
      fields: ["title"],
      rows: [["Original"]],
    });
    await expectError(
      service().apply(actor, { importId, fields: ["title"], rows: [["Tampered"]] }),
      "invalid",
      /changed since the preview/,
    );
    const bad = await service().preview(actor, {
      projectKey: "STK",
      filename: "bad.csv",
      fields: ["title", "points"],
      rows: [["Bad", "many"]],
    });
    expect(bad.validCount).toBe(0);
    await expectError(
      service().apply(actor, {
        importId: bad.importId,
        fields: ["title", "points"],
        rows: [["Bad", "many"]],
      }),
      "invalid",
      /No valid rows/,
    );
    await expectError(
      service().apply(actor, { importId: crypto.randomUUID(), fields: ["title"], rows: [["x"]] }),
      "not_found",
    );
  });

  it("re-validates at apply time: a status deleted since the preview skips its rows", async () => {
    const [extra] = await db
      .insert(statuses)
      .values({ projectId, name: "Imported Later", category: "todo", position: 99 })
      .returning({ id: statuses.id });
    if (!extra) throw new Error("no status");
    const rows = [
      ["Keeps", "Backlog"],
      ["Loses", "Imported Later"],
    ];
    const { importId, validCount } = await service().preview(actor, {
      projectKey: "STK",
      filename: "later.csv",
      fields: ["title", "status"],
      rows,
    });
    expect(validCount).toBe(2);
    await db.delete(statuses).where(eq(statuses.id, extra.id));
    await expect(
      service().apply(actor, { importId, fields: ["title", "status"], rows }),
    ).resolves.toMatchObject({ created: 1, skipped: 1 });
    expect(await importRow(importId)).toMatchObject({ createdCount: 1, errorCount: 1 });
  });

  it("allocates numbers that interleave safely with a concurrent quick create", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => [`Bulk ${i + 1}`]);
    const before = await counter();
    const { importId } = await service().preview(actor, {
      projectKey: "STK",
      filename: "bulk.csv",
      fields: ["title"],
      rows,
    });
    const issueService = createIssueService(db, { runAtomic: transactionRunner(db) });
    const [result, single] = await Promise.all([
      service().apply(actor, { importId, fields: ["title"], rows }),
      issueService.createIssue(actor, {
        projectKey: "STK",
        title: "Racer",
        type: "task",
        priority: 2,
      }),
    ]);
    expect(result.created).toBe(50);
    expect(await counter()).toBe(before + 51);
    const numbers = await db
      .select({ number: issues.number })
      .from(issues)
      .where(and(eq(issues.projectId, projectId), sql`${issues.number} > ${before}`))
      .orderBy(asc(issues.number));
    // Gapless and unique: the import's block and the single issue never overlap.
    expect(numbers.map((row) => row.number)).toEqual(
      Array.from({ length: 51 }, (_, i) => before + i + 1),
    );
    expect(single.number).toBeGreaterThan(before);
  });

  it("takes the 500-row maximum in one apply", async () => {
    const rows = Array.from({ length: IMPORT_MAX_ROWS }, (_, i) => [`Max ${i + 1}`, `${i % 4}`]);
    const { importId } = await service().preview(actor, {
      projectKey: "STK",
      filename: "max.csv",
      fields: ["title", "priority"],
      rows,
    });
    await expect(
      service().apply(actor, { importId, fields: ["title", "priority"], rows }),
    ).resolves.toMatchObject({ created: IMPORT_MAX_ROWS, skipped: 0 });
  });
});
