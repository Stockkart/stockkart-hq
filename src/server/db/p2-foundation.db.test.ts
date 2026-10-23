import { createHash, randomBytes, randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { allocateIncidentNumber } from "@/server/services/incident-numbers";
import { pgErrorInfo, ServiceError } from "@/server/services/errors";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import {
  activity,
  comments,
  docs,
  emailDeliveries,
  entityLinks,
  imports,
  incidents,
  incidentServices,
  incidentTimeline,
  notifications,
  projects,
  releases,
  services,
  sprints,
  statuses,
  templates,
  users,
} from "./schema";
import { seed } from "./seed";
import { type AppDatabase } from "./types";

/** Constraint name (or SQLSTATE) of the Postgres error a write failed with. */
async function violation(write: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await write;
  } catch (error) {
    return pgErrorInfo(error)?.constraint ?? pgErrorInfo(error)?.code;
  }
  return undefined;
}

const body = { type: "doc" as const, content: [] };

/** Migration 0005: the tables, columns and constraints the P2 slices build on (Postgres). */
describeDb("P2 foundation schema (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let alice: string;
  let projectId: string;
  let docId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    alice = await createTestUser(db, "Alice");
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, "STK"));
    if (!project) throw new Error("seed created no STK project");
    projectId = project.id;
    const [doc] = await db
      .insert(docs)
      .values({ projectId, title: "Postmortem", position: "a0", type: "postmortem" })
      .returning({ id: docs.id });
    if (!doc) throw new Error("no doc");
    docId = doc.id;
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("adds the P2 defaults to users, projects, statuses, sprints and releases", async () => {
    const [user] = await db.select().from(users).where(eq(users.id, alice));
    expect(user).toMatchObject({
      digestFrequency: "daily",
      lastDigestAt: null,
      emailUnsubscribeTokenHash: null,
    });
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project).toMatchObject({ incidentCounter: 0, autoRetro: false });
    const rows = await db.select().from(statuses).where(eq(statuses.projectId, projectId));
    expect(rows.every((row) => row.wipLimit === null)).toBe(true);
  });

  it("seeds the postmortem, release-notes and retro doc templates (INC-2, REL-2, SPR-5)", async () => {
    const builtIns = await db
      .select({ subtype: templates.subtype })
      .from(templates)
      .where(sql`${templates.kind} = 'doc' AND ${templates.builtIn}`);
    expect(builtIns.map((row) => row.subtype)).toEqual(
      expect.arrayContaining(["postmortem", "release_notes", "retro"]),
    );
  });

  it("statuses.wip_limit is null or 1…999", async () => {
    const [status] = await db
      .select({ id: statuses.id })
      .from(statuses)
      .where(eq(statuses.projectId, projectId));
    if (!status) throw new Error("no status");
    await db.update(statuses).set({ wipLimit: 3 }).where(eq(statuses.id, status.id));
    for (const wipLimit of [0, -1, 1000]) {
      expect(
        await violation(db.update(statuses).set({ wipLimit }).where(eq(statuses.id, status.id))),
      ).toBe("statuses_wip_limit_range");
    }
    await db.update(statuses).set({ wipLimit: null }).where(eq(statuses.id, status.id));
  });

  it("sprints.retro_doc_id and releases.notes_doc_id are cleared when the doc goes", async () => {
    const [doc] = await db
      .insert(docs)
      .values({ projectId, title: "Retro", position: "a1", type: "retro" })
      .returning({ id: docs.id });
    if (!doc) throw new Error("no doc");
    const [sprint] = await db
      .insert(sprints)
      .values({ projectId, name: "Sprint retro test", retroDocId: doc.id })
      .returning({ id: sprints.id });
    const [release] = await db
      .insert(releases)
      .values({ projectId, name: "v-retro-test", notesDocId: doc.id, description: "First" })
      .returning({ id: releases.id });
    if (!sprint || !release) throw new Error("no sprint or release");
    await db.delete(docs).where(eq(docs.id, doc.id));
    const [afterSprint] = await db.select().from(sprints).where(eq(sprints.id, sprint.id));
    const [afterRelease] = await db.select().from(releases).where(eq(releases.id, release.id));
    expect(afterSprint?.retroDocId).toBeNull();
    expect(afterRelease?.notesDocId).toBeNull();
  });

  it("releases: unique name per project; released_at only while released", async () => {
    await db.insert(releases).values({ projectId, name: "v1.0.0" });
    expect(await violation(db.insert(releases).values({ projectId, name: "v1.0.0" }))).toBe(
      "releases_project_name_unique",
    );
    expect(
      await violation(
        db.insert(releases).values({ projectId, name: "v2", releasedAt: new Date() }),
      ),
    ).toBe("releases_released_at_state");
    expect(
      await violation(db.insert(releases).values({ projectId, name: "v4", state: "released" })),
    ).toBe("releases_released_at_state");
    await db
      .insert(releases)
      .values({ projectId, name: "v3", state: "released", releasedAt: new Date() });
  });

  it("allows 'service' and 'release' as entity types (links, activity, notifications)", async () => {
    const serviceId = randomUUID();
    const releaseId = randomUUID();
    await db.insert(entityLinks).values([
      { fromType: "incident", fromId: randomUUID(), toType: "service", toId: serviceId },
      { fromType: "release", fromId: releaseId, toType: "doc", toId: docId },
    ]);
    await db.insert(activity).values({ entityType: "release", entityId: releaseId, action: "x" });
    await db.insert(notifications).values({
      userId: alice,
      type: "assigned",
      entityType: "incident",
      entityId: randomUUID(),
    });
    await db.insert(notifications).values([
      { userId: alice, type: "incident_commander", entityType: "incident", entityId: randomUUID() },
      { userId: alice, type: "comment_on_doc", entityType: "doc", entityId: docId },
    ]);
  });

  describe("services", () => {
    const newService = (overrides: Partial<typeof services.$inferInsert> = {}) =>
      db
        .insert(services)
        .values({
          projectId,
          name: "Inventory API",
          slug: "inventory-api",
          position: "a0",
          ...overrides,
        })
        .returning({ id: services.id });

    it("defaults to empty arrays and keeps slugs unique per project", async () => {
      const [created] = await newService({ repo: "Stockkart/inventory-api" });
      if (!created) throw new Error("no service");
      const [row] = await db.select().from(services).where(eq(services.id, created.id));
      expect(row).toMatchObject({ environments: [], links: [], deletedAt: null });
      expect(await violation(newService())).toBe("services_project_slug_unique");
      // Still taken while soft-deleted, so a restore can never collide.
      await db.update(services).set({ deletedAt: new Date() }).where(eq(services.id, created.id));
      expect(await violation(newService())).toBe("services_project_slug_unique");
    });

    it("checks the slug, the repo and that links/environments are bounded arrays", async () => {
      for (const slug of ["Inventory", "a--b", "-a", "a b", "x".repeat(65)]) {
        expect(await violation(newService({ slug })), slug).toBe("services_slug_format");
      }
      for (const repo of ["inventory-api", "Stockkart/", "a/b/c", "https://github.com/a/b"]) {
        expect(await violation(newService({ slug: "r", repo })), repo).toBe("services_repo_format");
      }
      expect(
        await violation(
          db.execute(
            sql`INSERT INTO services (project_id, name, slug, position, links)
              VALUES (${projectId}::uuid, 'n', 'obj', 'a0', '{"kind":"app"}'::jsonb)`,
          ),
        ),
      ).toBe("services_json_arrays");
      const tooMany = Array.from({ length: 51 }, () => ({ name: "e" }));
      expect(await violation(newService({ slug: "many", environments: tooMany }))).toBe(
        "services_json_arrays",
      );
      await newService({
        slug: "ok",
        environments: [{ name: "production", url: "https://example.test" }],
        links: [{ kind: "logs", label: "Logs", url: "https://logs.example.test" }],
      });
    });
  });

  describe("incidents", () => {
    it("numbers incidents per project, gapless under concurrent creates", async () => {
      const created = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          allocateIncidentNumber(db, alice, {
            projectId,
            title: `Outage ${index}`,
            severity: "sev2",
            commanderId: alice,
          }),
        ),
      );
      expect(created.map((row) => row.number).sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ]);
      const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
      expect(project?.incidentCounter).toBe(8);
      const logged = await db.select().from(activity).where(eq(activity.entityType, "incident"));
      expect(logged.filter((row) => row.action === "created")).toHaveLength(8);
    });

    it("refuses an archived or unknown project and leaves its counter alone", async () => {
      const [archived] = await db
        .insert(projects)
        .values({ key: "ARC", name: "Archived", archivedAt: new Date() })
        .returning({ id: projects.id });
      if (!archived) throw new Error("no project");
      for (const id of [archived.id, randomUUID()]) {
        await expect(
          allocateIncidentNumber(db, alice, { projectId: id, title: "x", severity: "sev3" }),
        ).rejects.toBeInstanceOf(ServiceError);
      }
      const [row] = await db.select().from(projects).where(eq(projects.id, archived.id));
      expect(row?.incidentCounter).toBe(0);
    });

    it("is found by title and summary, and keeps resolved_at in step with status", async () => {
      const { id } = await allocateIncidentNumber(db, alice, {
        projectId,
        title: "Checkout latency",
        severity: "sev1",
        summary: "Connection pool exhausted on inventory-api",
      });
      const hits = await db
        .select({ id: incidents.id })
        .from(incidents)
        .where(sql`${incidents.search} @@ plainto_tsquery('english', 'pool')`);
      expect(hits.map((hit) => hit.id)).toContain(id);

      const set = (values: Partial<typeof incidents.$inferInsert>) =>
        db.update(incidents).set(values).where(eq(incidents.id, id));
      expect(await violation(set({ status: "resolved" }))).toBe("incidents_resolved_at_status");
      expect(await violation(set({ resolvedAt: new Date() }))).toBe("incidents_resolved_at_status");
      expect(await violation(set({ mitigatedAt: new Date("2000-01-01") }))).toBe(
        "incidents_times_ordered",
      );
      expect(await violation(set({ status: "mitigated" }))).toBe("incidents_mitigated_at_status");
      expect(
        await violation(
          set({
            status: "resolved",
            mitigatedAt: new Date(),
            resolvedAt: new Date(Date.now() - 1000),
          }),
        ),
      ).toBe("incidents_times_ordered");
      expect(await violation(set({ title: "x".repeat(201) }))).toBe("incidents_title_length");
      await set({ status: "mitigated", mitigatedAt: new Date() });
      await set({ status: "resolved", resolvedAt: new Date(), postmortemDocId: docId });
      expect(
        await violation(
          db.insert(incidents).values({ projectId, number: 1, title: "dup", severity: "sev3" }),
        ),
      ).toBe("incidents_project_number_unique");
    });

    it("links services and timeline notes, removed with the incident", async () => {
      const { id } = await allocateIncidentNumber(db, alice, {
        projectId,
        title: "DB failover",
        severity: "sev2",
      });
      const [service] = await db
        .insert(services)
        .values({ projectId, name: "Mongo", slug: "mongo", position: "a5" })
        .returning({ id: services.id });
      if (!service) throw new Error("no service");
      await db.insert(incidentServices).values({ incidentId: id, serviceId: service.id });
      expect(
        await violation(
          db.insert(incidentServices).values({ incidentId: id, serviceId: service.id }),
        ),
      ).toBe("incident_services_incident_id_service_id_pk");
      await db.insert(incidentTimeline).values([
        { incidentId: id, kind: "note", body: "Paged", authorId: alice },
        { incidentId: id, kind: "status_change", body: "investigating → mitigated" },
      ]);
      expect(
        await violation(
          db.insert(incidentTimeline).values({ incidentId: id, kind: "note", body: "" }),
        ),
      ).toBe("incident_timeline_body_length");
      await db.delete(incidents).where(eq(incidents.id, id));
      expect(
        await db.select().from(incidentServices).where(eq(incidentServices.incidentId, id)),
      ).toEqual([]);
      expect(
        await db.select().from(incidentTimeline).where(eq(incidentTimeline.incidentId, id)),
      ).toEqual([]);
    });
  });

  describe("comments (DOC-13 inline threads)", () => {
    const newComment = (overrides: Partial<typeof comments.$inferInsert> = {}) =>
      db
        .insert(comments)
        .values({ entityType: "doc", entityId: docId, authorId: alice, body, ...overrides })
        .returning({ id: comments.id });

    it("anchors only doc comments, with a bounded quote and a well-formed mark id", async () => {
      const [thread] = await newComment({ anchorId: "c-1a2b", anchorText: "the pool size" });
      if (!thread) throw new Error("no comment");
      await newComment({ parentId: thread.id });
      await newComment(); // DOC-11 page-level comment.
      expect(
        await violation(newComment({ entityType: "issue", entityId: randomUUID(), anchorId: "x" })),
      ).toBe("comments_anchor_doc_only");
      expect(await violation(newComment({ anchorText: "quote without a mark" }))).toBe(
        "comments_anchor_text_needs_anchor",
      );
      expect(await violation(newComment({ anchorId: "x", anchorText: "q".repeat(501) }))).toBe(
        "comments_anchor_text_needs_anchor",
      );
      expect(await violation(newComment({ anchorId: '"><script>' }))).toBe(
        "comments_anchor_format",
      );
      expect(await violation(newComment({ resolvedBy: alice }))).toBe(
        "comments_resolved_by_needs_resolved_at",
      );
      // Replies carry no anchor or resolution, and live on their thread's entity.
      expect(await violation(newComment({ parentId: thread.id, anchorId: "c-2" }))).toBe(
        "comments_reply_plain",
      );
      expect(await violation(newComment({ parentId: thread.id, resolvedAt: new Date() }))).toBe(
        "comments_reply_plain",
      );
      expect(await violation(newComment({ parentId: thread.id, entityId: randomUUID() }))).toBe(
        "comments_parent_same_entity_fk",
      );
      expect(await violation(newComment({ parentId: thread.id, entityType: "issue" }))).toBe(
        "comments_parent_same_entity_fk",
      );
      await db
        .update(comments)
        .set({ resolvedAt: new Date(), resolvedBy: alice })
        .where(eq(comments.id, thread.id));
      await db.delete(comments).where(eq(comments.id, thread.id));
      const replies = await db.select().from(comments).where(eq(comments.parentId, thread.id));
      expect(replies).toEqual([]);
    });
  });

  it("users.email_unsubscribe_token_hash is a unique sha-256 hex", async () => {
    const hash = createHash("sha256").update(randomBytes(32)).digest("hex");
    await db.update(users).set({ emailUnsubscribeTokenHash: hash }).where(eq(users.id, alice));
    const bob = await createTestUser(db, "Bob");
    expect(
      await violation(
        db.update(users).set({ emailUnsubscribeTokenHash: hash }).where(eq(users.id, bob)),
      ),
    ).toBe("users_email_unsubscribe_token_hash_unique");
    expect(
      await violation(
        db.update(users).set({ emailUnsubscribeTokenHash: "not-a-hash" }).where(eq(users.id, bob)),
      ),
    ).toBe("users_email_unsubscribe_token_hash_format");
  });

  it("email_deliveries: one row per user, kind and period start", async () => {
    const periodStart = new Date("2026-01-01T00:00:00Z");
    const periodEnd = new Date("2026-01-02T00:00:00Z");
    const claim = () =>
      db
        .insert(emailDeliveries)
        .values({ userId: alice, kind: "digest", periodStart, periodEnd })
        .onConflictDoNothing()
        .returning({ id: emailDeliveries.id, status: emailDeliveries.status });
    const [claimed] = await claim();
    expect(claimed?.status).toBe("pending");
    expect(await claim()).toHaveLength(0);
    if (!claimed) throw new Error("no claim");
    await db
      .update(emailDeliveries)
      .set({ status: "sent", sentAt: new Date(), providerId: "msg_1" })
      .where(eq(emailDeliveries.id, claimed.id));
    const base = { userId: alice, kind: "digest" as const };
    const later = new Date("2026-02-01T00:00:00Z");
    expect(
      await violation(
        db.insert(emailDeliveries).values({
          ...base,
          periodStart: later,
          periodEnd: later,
          status: "skipped",
        }),
      ),
    ).toBe("email_deliveries_period_order");
    expect(
      await violation(
        db
          .insert(emailDeliveries)
          .values({ ...base, periodStart: later, periodEnd, status: "sent" }),
      ),
    ).toBe("email_deliveries_period_order");
    const next = { ...base, periodStart: periodEnd, periodEnd: later };
    expect(await violation(db.insert(emailDeliveries).values({ ...next, status: "sent" }))).toBe(
      "email_deliveries_sent_at_status",
    );
    expect(
      await violation(
        db
          .insert(emailDeliveries)
          .values({ ...next, status: "sent", sentAt: new Date(), errorCode: "x" }),
      ),
    ).toBe("email_deliveries_error_code");
    await db
      .insert(emailDeliveries)
      .values({ ...next, status: "failed", errorCode: "rate_limit_exceeded" });
  });

  it("imports: consistent counts, applied_at only when applied, bounded report", async () => {
    const base = {
      projectId,
      kind: "issues_csv" as const,
      filename: "issues.csv",
      createdBy: alice,
    };
    const [row] = await db
      .insert(imports)
      .values({ ...base, rowCount: 3, errorCount: 1, report: { errors: [{ row: 2 }] } })
      .returning({ id: imports.id });
    if (!row) throw new Error("no import");
    // Apply once: a second apply finds no `previewed` row and changes nothing.
    const apply = () =>
      db
        .update(imports)
        .set({ status: "applied", appliedAt: new Date(), createdCount: 2 })
        .where(sql`${imports.id} = ${row.id} AND ${imports.status} = 'previewed'`)
        .returning({ id: imports.id });
    expect(await apply()).toHaveLength(1);
    expect(await apply()).toHaveLength(0);
    expect(
      await violation(db.insert(imports).values({ ...base, rowCount: 1, createdCount: 2 })),
    ).toBe("imports_counts_valid");
    expect(await violation(db.insert(imports).values({ ...base, status: "applied" }))).toBe(
      "imports_applied_at_status",
    );
    expect(await violation(db.insert(imports).values({ ...base, filename: "" }))).toBe(
      "imports_filename_length",
    );
    expect(
      await violation(
        db.insert(imports).values({ ...base, report: { blob: "x".repeat(1024 * 1024) } }),
      ),
    ).toBe("imports_report_size");
  });
});
