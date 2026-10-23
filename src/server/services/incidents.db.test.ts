import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { declareIncidentInput } from "@/lib/incidents/schemas";
import { extractPlainText } from "@/lib/rich-text";
import { createServiceInput } from "@/lib/service-registry/schemas";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createDocQueries } from "./doc-queries";
import { createIncidentQueries, incidentIdByNumber } from "./incident-queries";
import { createIncidentService } from "./incidents";
import { createIssueService } from "./issues";
import { createSearchService } from "./search";
import { createServiceRegistry } from "./service-registry";
import { issueIdByNumber, projectIdByKey, rowsOf } from "./sql";

/** INC-1/2 against Postgres: numbering, lifecycle, timeline, follow-ups, postmortems. */
describeDb("incidents (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let ada: string;
  let bob: string;
  let apiId: string;
  let dbId: string;
  let service: ReturnType<typeof createIncidentService>;
  let queries: ReturnType<typeof createIncidentQueries>;
  const projectId = projectIdByKey("STK");

  const declare = (actorId: string, fields: Record<string, unknown> = {}) =>
    service.declareIncident(
      actorId,
      declareIncidentInput.parse({
        projectKey: "STK",
        title: "Outage",
        severity: "sev2",
        ...fields,
      }),
    );

  async function count(query: ReturnType<typeof sql>): Promise<number> {
    const result = await db.execute(query);
    return rowsOf(result, z.object({ n: z.number() }))[0]?.n ?? 0;
  }

  async function activityOf(incidentId: string) {
    const result = await db.execute(sql`
      SELECT action, field, from_value, to_value FROM activity
      WHERE entity_type = 'incident' AND entity_id = ${incidentId}::uuid
      ORDER BY created_at, id
    `);
    return rowsOf(
      result,
      z.object({
        action: z.string(),
        field: z.string().nullable(),
        from_value: z.string().nullable(),
        to_value: z.string().nullable(),
      }),
    );
  }

  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    ada = await createTestUser(db, "Ada Admin");
    bob = await createTestUser(db, "Bob Builder");
    service = createIncidentService(db, { runAtomic: transactionRunner(db) });
    queries = createIncidentQueries(db);
    const registry = createServiceRegistry(db, { runAtomic: transactionRunner(db) });
    apiId = (
      await registry.createService(
        ada,
        createServiceInput.parse({ projectKey: "STK", name: "API" }),
      )
    ).id;
    dbId = (
      await registry.createService(ada, createServiceInput.parse({ projectKey: "STK", name: "DB" }))
    ).id;
  });

  afterAll(async () => {
    await testDb?.close();
  });

  describe("declare (INC-1)", () => {
    it("numbers incidents gaplessly under concurrent declares", async () => {
      const created = await Promise.all(
        Array.from({ length: 8 }, (_, i) => declare(ada, { title: `Race ${i}` })),
      );
      expect(created.map((incident) => incident.number).sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ]);
      expect(created.every((incident) => incident.key === `INC-${incident.number}`)).toBe(true);
      // Each got its own "Incident declared" entry.
      expect(
        await count(sql`SELECT count(*)::int AS n FROM incident_timeline
          WHERE body = 'Incident declared'`),
      ).toBe(8);
    });

    it("stores services and the first timeline entry with the incident, and notifies the commander", async () => {
      const incident = await declare(ada, {
        title: "Checkout down",
        severity: "sev1",
        commanderId: bob,
        serviceIds: [apiId, dbId],
        summary: "Payments fail",
        startedAt: ago(30).toISOString(),
      });
      const detail = await queries.getIncident(projectId, incident.number);
      expect(detail).toMatchObject({
        title: "Checkout down",
        severity: "sev1",
        status: "investigating",
        commanderId: bob,
        commanderName: "Bob Builder",
        summary: "Payments fail",
      });
      expect(detail?.services.map((s) => s.id).sort()).toEqual([apiId, dbId].sort());
      const timeline = await queries.timeline(incident.id);
      expect(timeline).toEqual([
        expect.objectContaining({
          kind: "status_change",
          body: "Incident declared",
          authorId: ada,
        }),
      ]);
      expect(
        await count(sql`SELECT count(*)::int AS n FROM notifications
          WHERE user_id = ${bob}::uuid AND type = 'incident_commander'
            AND entity_type = 'incident' AND entity_id = ${incident.id}::uuid`),
      ).toBe(1);
    });

    it("defaults the commander to the declarer and never notifies yourself", async () => {
      const incident = await declare(ada);
      expect((await queries.getIncident(projectId, incident.number))?.commanderId).toBe(ada);
      expect(
        await count(sql`SELECT count(*)::int AS n FROM notifications
          WHERE entity_id = ${incident.id}::uuid`),
      ).toBe(0);
    });

    it("refuses unknown services and commanders, and rolls the counter back", async () => {
      const before = await count(sql`SELECT incident_counter AS n FROM projects WHERE key = 'STK'`);
      await expect(declare(ada, { serviceIds: [crypto.randomUUID()] })).rejects.toThrow(
        /Service not found/,
      );
      await expect(declare(ada, { commanderId: crypto.randomUUID() })).rejects.toThrow(
        /Commander not found/,
      );
      await expect(
        declare(ada, { startedAt: new Date(Date.now() + 86_400_000).toISOString() }),
      ).rejects.toThrow(/future/);
      expect(await count(sql`SELECT incident_counter AS n FROM projects WHERE key = 'STK'`)).toBe(
        before,
      );
    });
  });

  describe("status lifecycle", () => {
    it("mitigates, resolves and reopens with timeline and activity rows", async () => {
      const incident = await declare(ada, { startedAt: ago(60).toISOString() });
      const mitigatedAt = ago(40);
      await service.setStatus(ada, {
        incidentId: incident.id,
        from: "investigating",
        to: "mitigated",
        at: mitigatedAt,
      });
      let detail = await queries.getIncident(projectId, incident.number);
      expect(detail?.status).toBe("mitigated");
      expect(detail?.mitigatedAt).toEqual(mitigatedAt);

      await service.setStatus(ada, { incidentId: incident.id, from: "mitigated", to: "resolved" });
      detail = await queries.getIncident(projectId, incident.number);
      expect(detail?.status).toBe("resolved");
      expect(detail?.resolvedAt).not.toBeNull();

      await service.setStatus(ada, {
        incidentId: incident.id,
        from: "resolved",
        to: "investigating",
      });
      detail = await queries.getIncident(projectId, incident.number);
      expect(detail).toMatchObject({ status: "investigating", resolvedAt: null });
      expect(detail?.mitigatedAt).toEqual(mitigatedAt);

      const timeline = await queries.timeline(incident.id);
      expect(timeline.filter((e) => e.kind === "status_change").map((e) => e.body)).toEqual([
        "Incident declared",
        "Status: Investigating → Mitigated",
        "Status: Mitigated → Resolved",
        "Reopened: back to Investigating",
      ]);
      const activity = await activityOf(incident.id);
      expect(
        activity.filter((row) => row.field === "status").map((r) => [r.from_value, r.to_value]),
      ).toEqual([
        ["investigating", "mitigated"],
        ["mitigated", "resolved"],
        ["resolved", "investigating"],
      ]);
      expect(activity.filter((row) => row.field === "resolvedAt")).toHaveLength(2);
      expect(activity.find((row) => row.field === "mitigatedAt")?.to_value).toBe(
        mitigatedAt.toISOString(),
      );
    });

    it("refuses moves outside the lifecycle and stale ones", async () => {
      const incident = await declare(ada);
      await expect(
        service.setStatus(ada, {
          incidentId: incident.id,
          from: "investigating",
          to: "investigating",
        }),
      ).rejects.toThrow(/cannot go/);
      await expect(
        service.setStatus(ada, { incidentId: incident.id, from: "mitigated", to: "resolved" }),
      ).rejects.toThrow(/changed meanwhile/);
      await service.setStatus(ada, {
        incidentId: incident.id,
        from: "investigating",
        to: "mitigated",
      });
      await expect(
        service.setStatus(ada, { incidentId: incident.id, from: "mitigated", to: "investigating" }),
      ).rejects.toThrow(/cannot go/);
    });

    it("validates time order on transitions and time edits", async () => {
      const incident = await declare(ada, { startedAt: ago(60).toISOString() });
      await expect(
        service.setStatus(ada, {
          incidentId: incident.id,
          from: "investigating",
          to: "mitigated",
          at: ago(90),
        }),
      ).rejects.toThrow(/after the start/);
      await service.setStatus(ada, {
        incidentId: incident.id,
        from: "investigating",
        to: "mitigated",
        at: ago(30),
      });
      await expect(
        service.updateTimes(ada, {
          incidentId: incident.id,
          startedAt: ago(20),
          mitigatedAt: ago(30),
          resolvedAt: null,
        }),
      ).rejects.toThrow(/after the start/);
      await expect(
        service.updateTimes(ada, {
          incidentId: incident.id,
          startedAt: ago(60),
          mitigatedAt: null,
          resolvedAt: null,
        }),
      ).rejects.toThrow(/needs a mitigation time/);
      await service.updateTimes(ada, {
        incidentId: incident.id,
        startedAt: ago(70),
        mitigatedAt: ago(30),
        resolvedAt: null,
      });
      const activity = await activityOf(incident.id);
      expect(activity.filter((row) => row.field === "startedAt")).toHaveLength(1);
    });

    it("the DB CHECK still guards the order", async () => {
      const incident = await declare(ada, { startedAt: ago(10).toISOString() });
      await expect(
        db.execute(sql`UPDATE incidents SET status = 'mitigated', mitigated_at = ${ago(20).toISOString()}::timestamptz
          WHERE id = ${incident.id}::uuid`),
      ).rejects.toThrow();
    });
  });

  describe("fields, services and the timeline", () => {
    it("edits severity, commander and summary with activity, notifying a new commander", async () => {
      const incident = await declare(ada);
      await service.updateIncident(ada, {
        incidentId: incident.id,
        severity: "sev1",
        commanderId: bob,
        summary: "Now worse",
      });
      const activity = await activityOf(incident.id);
      expect(
        activity
          .filter((r) => r.action === "updated")
          .map((r) => r.field)
          .sort(),
      ).toEqual(["commanderId", "severity", "summary"]);
      expect(
        await count(sql`SELECT count(*)::int AS n FROM notifications
          WHERE user_id = ${bob}::uuid AND entity_id = ${incident.id}::uuid`),
      ).toBe(1);
      // Bob making himself commander again changes nothing and notifies nobody.
      await service.updateIncident(bob, { incidentId: incident.id, commanderId: bob });
      expect((await activityOf(incident.id)).filter((r) => r.field === "commanderId")).toHaveLength(
        1,
      );
    });

    it("replaces affected services and logs the change", async () => {
      const incident = await declare(ada, { serviceIds: [apiId] });
      await service.setServices(ada, { incidentId: incident.id, serviceIds: [dbId] });
      const detail = await queries.getIncident(projectId, incident.number);
      expect(detail?.services.map((s) => s.id)).toEqual([dbId]);
      const row = (await activityOf(incident.id)).find((r) => r.field === "services");
      expect(row).toMatchObject({ from_value: apiId, to_value: dbId });
    });

    it("adds notes and actions in `at` order; only the author edits or deletes them", async () => {
      const incident = await declare(ada, { startedAt: ago(60).toISOString() });
      const late = await service.addTimelineEntry(ada, {
        incidentId: incident.id,
        kind: "note",
        body: "Later note",
      });
      await service.addTimelineEntry(bob, {
        incidentId: incident.id,
        kind: "action",
        body: "Rolled back",
        at: ago(45),
      });
      const bodies = (await queries.timeline(incident.id)).map((e) => e.body);
      expect(bodies).toEqual(["Incident declared", "Rolled back", "Later note"]);

      await expect(
        service.editTimelineEntry(bob, { entryId: late.id, body: "Hijack", at: ago(1) }),
      ).rejects.toThrow(/your own/);
      await service.editTimelineEntry(ada, { entryId: late.id, body: "Edited note", at: ago(50) });
      // Without `at` only the text changes: the time keeps its seconds.
      const before = (await queries.timeline(incident.id)).find((e) => e.id === late.id)?.at;
      await service.editTimelineEntry(ada, { entryId: late.id, body: "Edited again" });
      const after = (await queries.timeline(incident.id)).find((e) => e.id === late.id);
      expect(after).toMatchObject({ body: "Edited again", at: before });
      const declared = (await queries.timeline(incident.id)).find(
        (e) => e.body === "Incident declared",
      );
      if (!declared) throw new Error("no declared entry");
      await expect(service.deleteTimelineEntry(ada, declared.id)).rejects.toThrow(
        /cannot be edited/,
      );
      await service.deleteTimelineEntry(ada, late.id);
      expect((await queries.timeline(incident.id)).map((e) => e.body)).toEqual([
        "Incident declared",
        "Rolled back",
      ]);
      expect((await activityOf(incident.id)).map((r) => r.action)).toEqual(
        expect.arrayContaining(["timeline_edited", "timeline_deleted"]),
      );
    });
  });

  describe("follow-ups and postmortems (INC-2)", () => {
    it("links follow-up issues both ways", async () => {
      const issues = createIssueService(db, { runAtomic: transactionRunner(db) });
      const issue = await issues.createIssue(ada, {
        projectKey: "STK",
        type: "task",
        title: "Add payment alerts",
        priority: 2,
      });
      const incident = await declare(ada, { title: "Payments" });
      const { linkId } = await service.linkFollowUp(ada, {
        incidentId: incident.id,
        issueKey: issue.key,
      });
      await expect(
        service.linkFollowUp(ada, { incidentId: incident.id, issueKey: issue.key }),
      ).rejects.toThrow(/already/);
      expect(await queries.followUps(incident.id)).toEqual([
        expect.objectContaining({ key: issue.key, title: "Add payment alerts" }),
      ]);
      const fromIssue = await queries.incidentsLinkingTo(issueIdByNumber(projectId, issue.number));
      expect(fromIssue).toEqual([
        {
          id: incident.id,
          key: incident.key,
          title: "Payments",
          href: `/STK/incidents/${incident.key}`,
        },
      ]);
      await service.unlinkFollowUp(ada, { incidentId: incident.id, linkId });
      expect(await queries.followUps(incident.id)).toEqual([]);
    });

    it("creates the postmortem once, filled from the incident, under Postmortems", async () => {
      const issues = createIssueService(db, { runAtomic: transactionRunner(db) });
      const followUp = await issues.createIssue(ada, {
        projectKey: "STK",
        type: "task",
        title: "Cache warmup",
        priority: 2,
      });
      const incident = await declare(ada, {
        title: "Cold cache",
        severity: "sev1",
        serviceIds: [apiId],
        summary: "Everything was slow.",
        startedAt: ago(120).toISOString(),
      });
      await service.addTimelineEntry(ada, {
        incidentId: incident.id,
        kind: "action",
        body: "Warmed the cache by hand",
        at: ago(100),
      });
      await service.setStatus(ada, {
        incidentId: incident.id,
        from: "investigating",
        to: "resolved",
      });
      await service.linkFollowUp(ada, { incidentId: incident.id, issueKey: followUp.key });

      // Two clicks at once: one doc, one Postmortems page.
      const [first, second] = await Promise.all([
        service.createPostmortem(ada, incident.id),
        service.createPostmortem(ada, incident.id),
      ]);
      expect(first.docId).toBe(second.docId);
      expect([first.created, second.created].sort()).toEqual([false, true]);
      const again = await service.createPostmortem(ada, incident.id);
      expect(again).toEqual({ docId: first.docId, created: false });

      const doc = await createDocQueries(db).getDoc(projectId, first.docId);
      expect(doc).toMatchObject({
        title: `Postmortem — ${incident.key} Cold cache`,
        type: "postmortem",
      });
      const text = doc?.content ? extractPlainText(doc.content) : "";
      expect(text).toContain("Everything was slow.");
      expect(text).toContain("Severity: SEV1");
      expect(text).toContain("Affected services: API");
      expect(text).toContain("Action: Warmed the cache by hand");
      expect(text.indexOf("Warmed the cache")).toBeLessThan(text.indexOf("Status: Investigating"));
      expect(text).toContain(`${followUp.key} Cache warmup`);
      // The follow-up key in the text is a mention link, so the issue lists the doc (DOC-9).
      const linking = await createDocQueries(db).docsLinkingTo(
        issueIdByNumber(projectId, followUp.number),
      );
      expect(linking.map((d) => d.id)).toContain(first.docId);

      const detail = await queries.getIncident(projectId, incident.number);
      expect(detail?.postmortem?.id).toBe(first.docId);
      const parents = await db.execute(sql`
        SELECT p.title, count(*) OVER ()::int AS n FROM docs d JOIN docs p ON p.id = d.parent_id
        WHERE d.id = ${first.docId}::uuid
      `);
      expect(rowsOf(parents, z.object({ title: z.string(), n: z.number() }))).toEqual([
        { title: "Postmortems", n: 1 },
      ]);

      // A second incident's postmortem goes under the same page.
      const other = await declare(ada, { title: "Other" });
      const otherDoc = await service.createPostmortem(ada, other.id);
      expect(
        await count(sql`SELECT count(*)::int AS n FROM docs WHERE title = 'Postmortems'
          AND parent_id IS NULL AND deleted_at IS NULL`),
      ).toBe(1);
      const otherParent = await count(sql`SELECT count(*)::int AS n FROM docs d JOIN docs p
        ON p.id = d.parent_id WHERE d.id = ${otherDoc.docId}::uuid AND p.title = 'Postmortems'`);
      expect(otherParent).toBe(1);

      // A deleted postmortem counts as missing: a new one is made.
      await db.execute(sql`UPDATE docs SET deleted_at = now() WHERE id = ${otherDoc.docId}::uuid`);
      const remade = await service.createPostmortem(ada, other.id);
      expect(remade.created).toBe(true);
      expect(remade.docId).not.toBe(otherDoc.docId);
    });
  });

  it("search finds incidents by title and summary", async () => {
    const incident = await declare(ada, {
      title: "Zebrafish ingestion stalled",
      summary: "The quokka importer hung",
    });
    const search = createSearchService(db);
    const byTitle = await search.search("zebrafish");
    expect(byTitle.incidents).toEqual([
      expect.objectContaining({
        kind: "incident",
        id: incident.id,
        title: `${incident.key} Zebrafish ingestion stalled`,
        href: `/STK/incidents/${incident.key}`,
        context: "SEV2",
      }),
    ]);
    expect((await search.search("quokka")).incidents.map((hit) => hit.id)).toEqual([incident.id]);
    // By key too.
    expect((await search.search(incident.key.toLowerCase())).incidents[0]?.id).toBe(incident.id);
    await db.execute(sql`UPDATE incidents SET deleted_at = now() WHERE id = ${incident.id}::uuid`);
    expect((await search.search("zebrafish")).incidents).toEqual([]);
  });

  it("filters the list and pins open incidents on top", async () => {
    const resolved = await declare(ada, {
      title: "Filter resolved",
      severity: "sev3",
      serviceIds: [dbId],
    });
    await service.setStatus(ada, {
      incidentId: resolved.id,
      from: "investigating",
      to: "resolved",
    });
    const list = await queries.listIncidents(projectId, {
      status: [],
      severity: [],
      service: null,
    });
    const firstResolved = list.findIndex((row) => row.status === "resolved");
    expect(list.slice(firstResolved).every((row) => row.status === "resolved")).toBe(true);
    const bySeverity = await queries.listIncidents(projectId, {
      status: ["resolved"],
      severity: ["sev3"],
      service: "db",
    });
    expect(bySeverity.map((row) => row.id)).toEqual([resolved.id]);
    expect(
      await queries.listIncidents(projectId, { status: [], severity: [], service: "nope" }),
    ).toEqual([]);
    expect(await queries.timeline(incidentIdByNumber(projectId, resolved.number))).not.toEqual([]);
  });
});
