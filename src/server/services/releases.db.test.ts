import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { EMPTY_FILTERS } from "@/lib/issues/filters";
import { RELEASE_ACTIONS, RELEASE_NOTES_PARENT_TITLE } from "@/lib/releases/constants";
import { extractPlainText } from "@/lib/rich-text";
import {
  activity,
  docs,
  docVersions,
  entityLinks,
  issues,
  projects,
  releases,
  statuses,
} from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createBulkService } from "./bulk";
import { createDocService } from "./docs";
import { ServiceError } from "./errors";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import { createPlanningQueries } from "./planning-queries";
import { createReleaseQueries } from "./release-queries";
import { createReleaseService } from "./releases";
import { projectIdByKey } from "./sql";

/** REL-1/2 against real Postgres (synthetic data only, S-7). */
describeDb("releases and fix versions (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let projectId: string;
  const runAtomic = () => transactionRunner(db);
  const service = () => createReleaseService(db, { runAtomic: runAtomic() });
  const issueService = () => createIssueService(db, { runAtomic: runAtomic() });
  const queries = () => createReleaseQueries(db);

  const statusId = async (name: string) => {
    const [row] = await db
      .select({ id: statuses.id })
      .from(statuses)
      .where(and(eq(statuses.projectId, projectId), eq(statuses.name, name)));
    if (!row) throw new Error(`no status ${name}`);
    return row.id;
  };

  const createRelease = async (name: string, releaseDate: string | null = null) =>
    (
      await service().createRelease(actor, {
        projectKey: "STK",
        name,
        releaseDate,
        description: null,
      })
    ).id;

  const createIssue = async (
    title: string,
    options: { type?: "bug" | "story" | "task"; releaseId?: string; status?: string } = {},
  ) => {
    const created = await issueService().createIssue(actor, {
      projectKey: "STK",
      title,
      type: options.type ?? "task",
      priority: 2,
      releaseId: options.releaseId,
    });
    if (options.status) {
      await issueService().updateIssueField(actor, {
        issueId: created.id,
        field: "status",
        value: await statusId(options.status),
      });
    }
    return created;
  };

  const releaseOf = async (issueId: string) => {
    const [row] = await db
      .select({ releaseId: issues.releaseId })
      .from(issues)
      .where(eq(issues.id, issueId));
    return row?.releaseId ?? null;
  };

  const releaseRow = async (id: string) => {
    const [row] = await db.select().from(releases).where(eq(releases.id, id));
    return row ?? null;
  };

  const fieldActivity = (issueId: string) =>
    db
      .select({ from: activity.fromValue, to: activity.toValue, meta: activity.meta })
      .from(activity)
      .where(
        and(
          eq(activity.entityType, "issue"),
          eq(activity.entityId, issueId),
          eq(activity.field, "release"),
        ),
      )
      .orderBy(asc(activity.createdAt), asc(activity.id));

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
    actor = await createTestUser(db, "Rel Ease");
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

  // ── REL-1 CRUD rules ──────────────────────────────────────────────────────────────────

  it("creates releases with unique names per project and logs it", async () => {
    const id = await createRelease("crud-v1", "2026-06-30");
    const row = await releaseRow(id);
    expect(row).toMatchObject({ name: "crud-v1", state: "unreleased", releasedAt: null });
    expect(row?.releaseDate).toBe("2026-06-30");
    await expectError(createRelease("crud-v1"), "conflict", /already exists/);
    const [logged] = await db
      .select({ action: activity.action })
      .from(activity)
      .where(and(eq(activity.entityType, "release"), eq(activity.entityId, id)));
    expect(logged?.action).toBe(RELEASE_ACTIONS.created);
  });

  it("edits name, date and description with one activity row per changed field", async () => {
    const id = await createRelease("edit-v1", "2026-07-01");
    await createRelease("edit-taken");
    await service().updateRelease(actor, {
      releaseId: id,
      name: "edit-v2",
      releaseDate: "2026-07-01",
      description: "Search and OCR",
    });
    const rows = await db
      .select({ field: activity.field, from: activity.fromValue, to: activity.toValue })
      .from(activity)
      .where(
        and(
          eq(activity.entityType, "release"),
          eq(activity.entityId, id),
          eq(activity.action, RELEASE_ACTIONS.updated),
        ),
      )
      .orderBy(asc(activity.field));
    expect(rows).toEqual([
      { field: "description", from: null, to: "Search and OCR" },
      { field: "name", from: "edit-v1", to: "edit-v2" },
    ]);
    await expectError(
      service().updateRelease(actor, {
        releaseId: id,
        name: "edit-taken",
        releaseDate: null,
        description: null,
      }),
      "conflict",
      /already exists/,
    );
    await expectError(
      service().updateRelease(actor, {
        releaseId: crypto.randomUUID(),
        name: "x",
        releaseDate: null,
        description: null,
      }),
      "not_found",
    );
  });

  it("deletes only an unreleased release without issues, or after unsetting it on them", async () => {
    const empty = await createRelease("del-empty");
    await expect(
      service().deleteRelease(actor, { releaseId: empty, unsetIssues: false }),
    ).resolves.toEqual({
      cleared: 0,
    });
    expect(await releaseRow(empty)).toBeNull();

    const used = await createRelease("del-used");
    const live = await createIssue("Has the fix version", { releaseId: used });
    const trashed = await createIssue("Trashed with it", { releaseId: used });
    await issueService().deleteIssue(actor, trashed.id);
    await expectError(
      service().deleteRelease(actor, { releaseId: used, unsetIssues: false }),
      "conflict",
      /^1 issue has this fix version/,
    );
    expect(await releaseRow(used)).not.toBeNull();

    await expect(
      service().deleteRelease(actor, { releaseId: used, unsetIssues: true }),
    ).resolves.toEqual({
      cleared: 1,
    });
    expect(await releaseRow(used)).toBeNull();
    expect(await releaseOf(live.id)).toBeNull();
    expect(await releaseOf(trashed.id)).toBeNull();
    // Every cleared fix version is in the history, the trashed issue's too.
    for (const issue of [live, trashed]) {
      const rows = await fieldActivity(issue.id);
      expect(rows.at(-1)).toMatchObject({
        from: used,
        to: null,
        meta: { reason: "release_deleted", fromName: "del-used" },
      });
    }

    const shipped = await createRelease("del-shipped");
    await service().markReleased(actor, { releaseId: shipped });
    await expectError(
      service().deleteRelease(actor, { releaseId: shipped, unsetIssues: true }),
      "invalid",
      /reopen it first/,
    );
    await expectError(
      service().deleteRelease(actor, { releaseId: crypto.randomUUID(), unsetIssues: false }),
      "not_found",
    );
  });

  it("marks released (state and released_at together) and reopens (clearing it)", async () => {
    const id = await createRelease("ship-v1");
    await createIssue("Done already", { releaseId: id, status: "Done" });
    await expect(service().markReleased(actor, { releaseId: id })).resolves.toEqual({
      moved: 0,
      openIssues: 0,
    });
    const released = await releaseRow(id);
    expect(released?.state).toBe("released");
    expect(released?.releasedAt).toBeInstanceOf(Date);
    await expectError(service().markReleased(actor, { releaseId: id }), "invalid", /already/);

    await service().reopenRelease(actor, id);
    expect(await releaseRow(id)).toMatchObject({ state: "unreleased", releasedAt: null });
    await expectError(service().reopenRelease(actor, id), "invalid");
    const actions = await db
      .select({ action: activity.action, from: activity.fromValue, to: activity.toValue })
      .from(activity)
      .where(
        and(
          eq(activity.entityType, "release"),
          eq(activity.entityId, id),
          eq(activity.field, "state"),
        ),
      )
      .orderBy(asc(activity.createdAt));
    expect(actions).toEqual([
      { action: RELEASE_ACTIONS.released, from: "unreleased", to: "released" },
      { action: RELEASE_ACTIONS.reopened, from: "released", to: "unreleased" },
    ]);
    // The DB CHECK pairs the two columns: a write of one alone is refused.
    await expect(
      db.execute(sql`UPDATE releases SET state = 'released' WHERE id = ${id}::uuid`),
    ).rejects.toThrow();
  });

  it("warns about open issues, then moves them to another release or releases anyway", async () => {
    const id = await createRelease("open-v1");
    const next = await createRelease("open-v2");
    const done = await createIssue("Shipped", { releaseId: id, status: "Done" });
    const open = await createIssue("Still open", { releaseId: id, status: "In Progress" });
    const wontDo = await createIssue("Dropped", { releaseId: id, status: "Won't Do" });

    // The warning path: nothing changes until the caller chooses.
    await expectError(
      service().markReleased(actor, { releaseId: id }),
      "conflict",
      /^1 issue is not done yet/,
    );
    expect((await releaseRow(id))?.state).toBe("unreleased");

    // A released (or missing) target is refused, again changing nothing.
    const closed = await createRelease("open-closed");
    await service().markReleased(actor, { releaseId: closed });
    await expectError(
      service().markReleased(actor, {
        releaseId: id,
        openIssues: { action: "move", targetReleaseId: closed },
      }),
      "not_found",
    );
    expect(await releaseOf(open.id)).toBe(id);

    await expect(
      service().markReleased(actor, {
        releaseId: id,
        openIssues: { action: "move", targetReleaseId: next },
      }),
    ).resolves.toEqual({ moved: 1, openIssues: 1 });
    expect((await releaseRow(id))?.state).toBe("released");
    expect(await releaseOf(open.id)).toBe(next);
    expect(await releaseOf(done.id)).toBe(id);
    expect(await releaseOf(wontDo.id)).toBe(id);
    expect((await fieldActivity(open.id)).at(-1)).toMatchObject({ from: id, to: next });

    // "Release anyway" keeps the open issue on the release.
    await expect(
      service().markReleased(actor, { releaseId: next, openIssues: { action: "keep" } }),
    ).resolves.toEqual({ moved: 0, openIssues: 1 });
    expect(await releaseOf(open.id)).toBe(next);
    expect((await releaseRow(next))?.state).toBe("released");
  });

  it("lists unreleased first by date, then released newest first, with progress", async () => {
    const list = await queries().listReleases(projectIdByKey("STK"));
    const unreleased = list.filter((release) => release.state === "unreleased");
    const released = list.filter((release) => release.state === "released");
    expect(list.slice(0, unreleased.length)).toEqual(unreleased);
    const dates = unreleased.map((release) => release.releaseDate);
    const dated = dates.filter((date): date is string => date !== null);
    expect(dated).toEqual([...dated].sort());
    expect(dates.slice(dated.length).every((date) => date === null)).toBe(true);
    const times = released.map((release) => release.releasedAt?.getTime() ?? 0);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    const shipped = list.find((release) => release.name === "open-v1");
    expect(shipped).toMatchObject({ total: { count: 2 }, done: { count: 2 } });
  });

  // ── Fix version on issues ─────────────────────────────────────────────────────────────

  it("sets the fix version with activity rows (quick create, side panel, bulk) and filters by it", async () => {
    const a = await createRelease("fix-a");
    const b = await createRelease("fix-b");
    const created = await createIssue("Created with a fix version", { releaseId: a });
    expect(await fieldActivity(created.id)).toEqual([{ from: null, to: a, meta: null }]);

    const panel = await createIssue("Set from the side panel");
    const change = await issueService().updateIssueField(actor, {
      issueId: panel.id,
      field: "release",
      value: b,
    });
    expect(change).toEqual({ from: null, to: b, changed: true });
    // Setting the same value again logs nothing.
    await issueService().updateIssueField(actor, { issueId: panel.id, field: "release", value: b });
    expect(await fieldActivity(panel.id)).toHaveLength(1);

    const bulk = createBulkService(db);
    await expect(
      bulk.bulkEdit(actor, {
        projectKey: "STK",
        issueIds: [created.id, panel.id],
        change: { kind: "release", releaseId: b },
      }),
    ).resolves.toEqual({ changed: 1 });
    expect((await fieldActivity(created.id)).at(-1)).toMatchObject({ from: a, to: b });

    const none = await createIssue("No fix version");
    const planning = createPlanningQueries(db);
    const list = (releasesFilter: string[]) =>
      planning
        .listIssues(projectIdByKey("STK"), {
          scope: "all",
          filters: { ...EMPTY_FILTERS, releases: releasesFilter },
          currentUserId: actor,
        })
        .then((rows) => rows.map((row) => row.id));
    expect(new Set(await list([b]))).toEqual(new Set([created.id, panel.id]));
    expect(await list(["none"])).toContain(none.id);
    expect(await list(["none"])).not.toContain(panel.id);
    expect(new Set(await list([b, "none"]))).toEqual(
      new Set([created.id, panel.id, ...(await list(["none"]))]),
    );
    const [row] = (
      await planning.listIssues(projectIdByKey("STK"), {
        scope: "all",
        filters: { ...EMPTY_FILTERS, releases: [b] },
        currentUserId: actor,
      })
    ).filter((issue) => issue.id === panel.id);
    expect(row?.releaseId).toBe(b);
  });

  it("refuses a release of another project or an unknown one, and shows releases in the meta", async () => {
    const [other] = await db
      .insert(projects)
      .values({ key: "OTH", name: "Other" })
      .returning({ id: projects.id });
    if (!other) throw new Error("no project");
    const [foreign] = await db
      .insert(releases)
      .values({ projectId: other.id, name: "foreign-v1" })
      .returning({ id: releases.id });
    if (!foreign) throw new Error("no release");
    const issue = await createIssue("Stays without one");
    await expectError(
      issueService().updateIssueField(actor, {
        issueId: issue.id,
        field: "release",
        value: foreign.id,
      }),
      "not_found",
      /Release/,
    );
    await expectError(
      issueService().createIssue(actor, {
        projectKey: "STK",
        title: "x",
        type: "task",
        priority: 2,
        releaseId: foreign.id,
      }),
      "not_found",
    );
    await expectError(
      createBulkService(db).bulkEdit(actor, {
        projectKey: "STK",
        issueIds: [issue.id],
        change: { kind: "release", releaseId: foreign.id },
      }),
      "not_found",
    );
    expect(await releaseOf(issue.id)).toBeNull();

    const meta = await createIssueQueries(db).getProjectMeta(projectIdByKey("STK"));
    expect(meta.releases.map((release) => release.name)).not.toContain("foreign-v1");
    const states = meta.releases.map((release) => release.state);
    expect(states).toEqual([...states].sort((x, y) => (x === y ? 0 : x === "unreleased" ? -1 : 1)));
  });

  // ── REL-2 release notes ───────────────────────────────────────────────────────────────

  it("generates the notes doc under a Release notes page, grouped by type, idempotently", async () => {
    const id = await createRelease("notes-v1", "2026-08-01");
    const feature = await createIssue("Search by barcode", {
      type: "story",
      releaseId: id,
      status: "Done",
    });
    const fix = await createIssue("OOM on upload", { type: "bug", releaseId: id, status: "Done" });
    await createIssue("Dropped idea", { type: "story", releaseId: id, status: "Won't Do" });
    await createIssue("Not done", { type: "task", releaseId: id, status: "Todo" });

    const first = await service().generateNotes(actor, id);
    expect(first.outcome).toBe("created");
    const [doc] = await db.select().from(docs).where(eq(docs.id, first.docId));
    expect(doc).toMatchObject({
      title: "Release notes — notes-v1",
      type: "release_notes",
      version: 1,
    });
    expect((await releaseRow(id))?.notesDocId).toBe(first.docId);
    const text = extractPlainText(doc?.content ?? { type: "doc" });
    expect(text).toContain(
      `Features\n${feature.key} Search by barcode\nFixes\n${fix.key} OOM on upload`,
    );
    expect(text).not.toContain("Dropped idea");
    expect(text).not.toContain("Not done");
    expect(text).toContain("Tech debt & other\nNone.\nBreaking changes\nMigration steps");
    // DOC-9: the keys are mention links from the doc.
    const links = await db
      .select({ to: entityLinks.toId })
      .from(entityLinks)
      .where(and(eq(entityLinks.fromType, "doc"), eq(entityLinks.fromId, first.docId)));
    expect(new Set(links.map((link) => link.to))).toEqual(new Set([feature.id, fix.id]));

    // Nested under the (one) "Release notes" root page.
    const [parent] = await db
      .select({ id: docs.id })
      .from(docs)
      .where(
        and(
          eq(docs.projectId, projectId),
          isNull(docs.parentId),
          eq(docs.title, RELEASE_NOTES_PARENT_TITLE),
        ),
      );
    expect(doc?.parentId).toBe(parent?.id);

    // Again with nothing new: the same doc, untouched.
    await expect(service().generateNotes(actor, id)).resolves.toEqual({
      docId: first.docId,
      outcome: "unchanged",
    });
    const [same] = await db
      .select({ version: docs.version })
      .from(docs)
      .where(eq(docs.id, first.docId));
    expect(same?.version).toBe(1);

    // A second release's notes reuse the parent page.
    const other = await createRelease("notes-v2");
    const second = await service().generateNotes(actor, other);
    const parents = await db
      .select({ id: docs.id })
      .from(docs)
      .where(and(eq(docs.projectId, projectId), eq(docs.title, RELEASE_NOTES_PARENT_TITLE)));
    expect(parents).toHaveLength(1);
    const [secondDoc] = await db
      .select({ parentId: docs.parentId })
      .from(docs)
      .where(eq(docs.id, second.docId));
    expect(secondDoc?.parentId).toBe(parent?.id);
  });

  it("rewrites untouched notes in place, keeps a version of edited ones, remakes trashed ones", async () => {
    const id = await createRelease("regen-v1");
    const first = await createIssue("First fix", { type: "bug", releaseId: id, status: "Done" });
    const created = await service().generateNotes(actor, id);

    // Untouched since generation: a new issue is rewritten into the same doc.
    const second = await createIssue("Second fix", { type: "bug", releaseId: id, status: "Done" });
    await expect(service().generateNotes(actor, id)).resolves.toEqual({
      docId: created.docId,
      outcome: "updated",
    });
    const [updated] = await db.select().from(docs).where(eq(docs.id, created.docId));
    expect(updated?.version).toBe(2);
    expect(extractPlainText(updated?.content ?? { type: "doc" })).toContain(
      `${first.key} First fix\n${second.key} Second fix`,
    );

    // Edited by a person (the docs optimistic-lock save): regenerating makes a new version
    // and keeps the edited state in the history.
    const docService = createDocService(db, { runAtomic: runAtomic() });
    const edited = {
      type: "doc" as const,
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hand-written notes" }] }],
    };
    const saved = await docService.saveDoc(actor, {
      docId: created.docId,
      baseVersion: 2,
      content: edited,
      snapshot: false,
    });
    expect(saved.status).toBe("saved");
    await expect(service().generateNotes(actor, id)).resolves.toEqual({
      docId: created.docId,
      outcome: "new_version",
    });
    const versions = await db
      .select({ version: docVersions.version, content: docVersions.content })
      .from(docVersions)
      .where(eq(docVersions.docId, created.docId))
      .orderBy(asc(docVersions.version));
    expect(versions.map((version) => version.version)).toEqual([1, 2, 3, 4]);
    expect(extractPlainText(versions[2]?.content ?? { type: "doc" })).toBe("Hand-written notes");
    const [regenerated] = await db.select().from(docs).where(eq(docs.id, created.docId));
    expect(regenerated?.version).toBe(4);
    expect(extractPlainText(regenerated?.content ?? { type: "doc" })).toContain("Second fix");
    // Untouched again since this generation.
    await expect(service().generateNotes(actor, id)).resolves.toMatchObject({
      outcome: "unchanged",
    });

    // A trashed notes doc counts as none: a new doc is made and linked.
    await docService.deleteDoc(actor, created.docId);
    const remade = await service().generateNotes(actor, id);
    expect(remade.outcome).toBe("created");
    expect(remade.docId).not.toBe(created.docId);
    expect((await releaseRow(id))?.notesDocId).toBe(remade.docId);
  });

  it("makes one notes doc when two generations race", async () => {
    const id = await createRelease("race-v1");
    await createIssue("Racing fix", { type: "bug", releaseId: id, status: "Done" });
    const [a, b] = await Promise.all([
      service().generateNotes(actor, id),
      service().generateNotes(actor, id),
    ]);
    expect(a?.docId).toBe(b?.docId);
    expect([a?.outcome, b?.outcome].sort()).toEqual(["created", "unchanged"]);
    const notes = await db
      .select({ id: docs.id })
      .from(docs)
      .where(and(eq(docs.title, "Release notes — race-v1"), isNull(docs.deletedAt)));
    expect(notes).toHaveLength(1);
  });

  it("treats a double-clicked regeneration as one (the second reports unchanged)", async () => {
    const id = await createRelease("double-v1");
    await createIssue("First", { type: "bug", releaseId: id, status: "Done" });
    const { docId } = await service().generateNotes(actor, id);
    await createIssue("Second", { type: "bug", releaseId: id, status: "Done" });
    const results = await Promise.all([
      service().generateNotes(actor, id),
      service().generateNotes(actor, id),
    ]);
    expect(results.map((result) => result.docId)).toEqual([docId, docId]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["unchanged", "updated"]);
  });

  it("queues two crossing 'release and move open issues to the other' calls (no deadlock)", async () => {
    const a = await createRelease("cross-a");
    const b = await createRelease("cross-b");
    await createIssue("Open in A", { releaseId: a });
    await createIssue("Open in B", { releaseId: b });
    const settled = await Promise.allSettled([
      service().markReleased(actor, {
        releaseId: a,
        openIssues: { action: "move", targetReleaseId: b },
      }),
      service().markReleased(actor, {
        releaseId: b,
        openIssues: { action: "move", targetReleaseId: a },
      }),
    ]);
    // One wins; the other then finds its target released and refuses with a clear error.
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [rejected] = settled.filter((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(ServiceError);
  });
});
