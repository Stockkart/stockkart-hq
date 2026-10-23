import { afterAll, beforeAll, expect, it } from "vitest";

import { declareIncidentInput } from "@/lib/incidents/schemas";
import { createServiceInput } from "@/lib/service-registry/schemas";
import { createBatchedRead, type Read } from "@/server/db/read-batch";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";
import { appLayoutReads } from "@/test/page-reads";

import { createCommentService } from "./comments";
import { createDocQueries } from "./doc-queries";
import { createFileQueries } from "./files";
import { createGithubQueries } from "./github-queries";
import { createIncidentQueries, incidentIdByNumber } from "./incident-queries";
import { createIncidentService } from "./incidents";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import {
  createServiceRegistry,
  createServiceRegistryQueries,
  serviceIdBySlug,
} from "./service-registry";
import { issueIdByNumber, projectIdByKey } from "./sql";
import { createWatcherService } from "./watchers";

/**
 * README "Performance": the service and incident pages load in ONE database round trip
 * (see sprint-pages.db.test.ts for how flushes are counted). Each block starts exactly the
 * reads its page (plus the app layout) starts.
 */
describeDb("round trips of the service and incident pages (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let incidentNumber: number;
  let followUpNumber: number;

  function counted(): { read: Read; trips: () => number } {
    let flushes = 0;
    const read = createBatchedRead(
      () => Promise.reject(new Error("count only: run each query alone")),
      (flush) => {
        flushes += 1;
        setImmediate(flush);
      },
    );
    return { read, trips: () => flushes };
  }

  function services(read: Read) {
    return {
      issueQueries: createIssueQueries(db, { read }),
      docQueries: createDocQueries(db, { read }),
      registryQueries: createServiceRegistryQueries(db, { read }),
      incidentQueries: createIncidentQueries(db, { read }),
    };
  }

  const layout = (read: Read) => appLayoutReads(db, read, actor);

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
    const runAtomic = transactionRunner(db);
    const registry = createServiceRegistry(db, { runAtomic });
    const api = await registry.createService(
      actor,
      createServiceInput.parse({ projectKey: "STK", name: "API" }),
    );
    const incident = await createIncidentService(db, { runAtomic }).declareIncident(
      actor,
      declareIncidentInput.parse({
        projectKey: "STK",
        title: "Slow API",
        severity: "sev2",
        serviceIds: [api.id],
      }),
    );
    incidentNumber = incident.number;
    const issue = await createIssueService(db, { runAtomic }).createIssue(actor, {
      projectKey: "STK",
      type: "task",
      title: "Speed up the API",
      priority: 2,
    });
    followUpNumber = issue.number;
    await createIncidentService(db, { runAtomic }).linkFollowUp(actor, {
      incidentId: incident.id,
      issueKey: issue.key,
    });
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("service list: one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const [, , , , project, cards] = await Promise.all([
      ...layout(read),
      s.issueQueries.getProject("STK"),
      s.registryQueries.listServices(projectIdByKey("STK")),
    ]);
    expect(trips()).toBe(1);
    expect(project?.key).toBe("STK");
    expect(cards).toEqual([expect.objectContaining({ slug: "api", recentIncidents: 1 })]);
  });

  it("service detail: one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const projectId = projectIdByKey("STK");
    const serviceId = serviceIdBySlug(projectId, "api");
    const [, , , , , detail, incidents, links, users] = await Promise.all([
      ...layout(read),
      s.issueQueries.getProject("STK"),
      s.registryQueries.getService(projectId, "api"),
      s.registryQueries.serviceIncidents(serviceId),
      s.registryQueries.serviceLinks(serviceId),
      s.registryQueries.userOptions(),
    ]);
    expect(trips()).toBe(1);
    expect(detail?.name).toBe("API");
    expect(incidents.map((row) => row.title)).toEqual(["Slow API"]);
    expect(links).toEqual([]);
    expect(users.map((user) => user.id)).toContain(actor);
  });

  it("incident list (filtered): one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const projectId = projectIdByKey("STK");
    const [, , , , , rows, options, users] = await Promise.all([
      ...layout(read),
      s.issueQueries.getProject("STK"),
      s.incidentQueries.listIncidents(projectId, {
        status: ["investigating"],
        severity: [],
        service: "api",
      }),
      s.incidentQueries.serviceOptions(projectId),
      s.docQueries.listUsers(),
    ]);
    expect(trips()).toBe(1);
    expect(rows.map((row) => row.number)).toEqual([incidentNumber]);
    expect(options.map((option) => option.slug)).toEqual(["api"]);
    expect(users.length).toBeGreaterThan(0);
  });

  it("incident detail: one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const projectId = projectIdByKey("STK");
    const incidentId = incidentIdByNumber(projectId, incidentNumber);
    const [, , , , , incident, timeline, followUps, activity, options, users] = await Promise.all([
      ...layout(read),
      s.issueQueries.getProject("STK"),
      s.incidentQueries.getIncident(projectId, incidentNumber),
      s.incidentQueries.timeline(incidentId),
      s.incidentQueries.followUps(incidentId),
      s.incidentQueries.activity(incidentId),
      s.incidentQueries.serviceOptions(projectId),
      s.docQueries.listUsers(),
    ]);
    expect(trips()).toBe(1);
    expect(incident?.title).toBe("Slow API");
    expect(timeline.map((entry) => entry.body)).toEqual(["Incident declared"]);
    expect(followUps.map((item) => item.title)).toEqual(["Speed up the API"]);
    expect(activity.map((row) => row.action)).toContain("created");
    expect(options).toHaveLength(1);
    expect(users.length).toBeGreaterThan(0);
  });

  it("issue page with its incident links: still one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const projectId = projectIdByKey("STK");
    const issueId = issueIdByNumber(projectId, followUpNumber);
    const results = await Promise.all([
      ...layout(read),
      s.issueQueries.getProject("STK"),
      s.issueQueries.getIssue(projectId, followUpNumber),
      s.issueQueries.getProjectMeta(projectId),
      s.issueQueries.listChildren(issueId),
      s.issueQueries.listLinks(issueId),
      s.issueQueries.listMentionedIn(issueId),
      createCommentService(db, { runAtomic: transactionRunner(db), read }).listForIssue(issueId),
      s.issueQueries.listActivity(issueId),
      s.issueQueries.listProjectKeys(),
      s.issueQueries.listSubtaskParents(projectId, issueId),
      s.docQueries.docsLinkingTo(issueId),
      createGithubQueries(db, { read }).listDevelopment(issueId),
      createWatcherService(db, { read }).list(issueId),
      createFileQueries(db, { read }).listAttachments("issue", issueId),
      s.incidentQueries.incidentsLinkingTo(issueId),
    ]);
    expect(trips()).toBe(1);
    expect(results.at(-1)).toEqual([
      expect.objectContaining({ key: `INC-${incidentNumber}`, title: "Slow API" }),
    ]);
  });
});
