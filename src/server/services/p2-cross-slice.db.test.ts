import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { declareIncidentInput } from "@/lib/incidents/schemas";
import { rt } from "@/lib/rich-text";
import { users } from "@/server/db/schema";
import { createBatchedRead, type Read } from "@/server/db/read-batch";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createDigestJob } from "@/server/email/digest";
import { type EmailMessage } from "@/server/email/resend";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";
import { appLayoutReads } from "@/test/page-reads";

import { createCommentService } from "./comments";
import { createDocQueries } from "./doc-queries";
import { createFileQueries } from "./files";
import { createGithubQueries } from "./github-queries";
import { createIncidentQueries } from "./incident-queries";
import { createIncidentService } from "./incidents";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import { createNotificationQueries } from "./notification-queries";
import { createReleaseService } from "./releases";
import { issueIdByNumber, projectIdByKey } from "./sql";
import { createWatcherService } from "./watchers";

const BASE = "https://hq.example.test";
const text = (value: string) => rt.doc(rt.paragraph(value));

/**
 * P2 cross-slice checks against Postgres (HQ_DB_TESTS=1): the docs the incidents slice
 * (postmortem) and the releases slice (release notes) generate take the comments slice's
 * page-level and inline comments, and the email digest links the incidents slice's
 * `incident_commander` and the comments slice's `comment_on_doc` notifications correctly.
 */
describeDb("P2 cross-slice: generated docs, comments and the digest (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let ada: string;
  let bob: string;
  let incidentNumber: number;
  let postmortemId: string;
  let notesId: string;
  const projectId = projectIdByKey("STK");

  const comments = () => createCommentService(db, { runAtomic: transactionRunner(db) });

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    ada = await createTestUser(db, "Ada Admin");
    bob = await createTestUser(db, "Bob Builder");

    const incidents = createIncidentService(db, { runAtomic: transactionRunner(db) });
    const incident = await incidents.declareIncident(
      ada,
      declareIncidentInput.parse({
        projectKey: "STK",
        title: "Checkout API down",
        severity: "sev2",
        commanderId: bob,
      }),
    );
    incidentNumber = incident.number;
    postmortemId = (await incidents.createPostmortem(ada, incident.id)).docId;

    const releases = createReleaseService(db, { runAtomic: transactionRunner(db) });
    const release = await releases.createRelease(ada, {
      projectKey: "STK",
      name: "api-v9.9",
      releaseDate: null,
      description: null,
    });
    notesId = (await releases.generateNotes(ada, release.id)).docId;
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("the postmortem and the release notes take page-level and inline comments", async () => {
    const docQueries = createDocQueries(db);
    for (const [docId, type] of [
      [postmortemId, "postmortem"],
      [notesId, "release_notes"],
    ] as const) {
      expect(await docQueries.getDoc(projectId, docId)).toMatchObject({ id: docId, type });
      const page = await comments().createDocComment(bob, { docId, body: text("Overall ok") });
      const inline = await comments().createDocComment(bob, {
        docId,
        body: text("Source?"),
        anchor: { id: `Anchor_${type}`, text: "the claim" },
      });
      await comments().createDocComment(ada, { docId, body: text("Fixed"), parentId: inline.id });
      await comments().setThreadResolved(ada, { commentId: inline.id, resolved: true });

      const threads = await comments().listForDoc(docId);
      expect(threads.map((thread) => [thread.id, thread.anchorId])).toEqual(
        expect.arrayContaining([
          [page.id, null],
          [inline.id, `Anchor_${type}`],
        ]),
      );
      const resolved = threads.find((thread) => thread.id === inline.id);
      expect(resolved?.resolvedAt).toBeInstanceOf(Date);
      expect(resolved?.replies).toHaveLength(1);
    }
  });

  it("the postmortem's doc page with comments is still one round trip", async () => {
    let flushes = 0;
    const read: Read = createBatchedRead(
      () => Promise.reject(new Error("count only: run each query alone")),
      (flush) => {
        flushes += 1;
        setImmediate(flush);
      },
    );
    const docQueries = createDocQueries(db, { read });
    const issueQueries = createIssueQueries(db, { read });
    const results = await Promise.all([
      ...appLayoutReads(db, read, ada),
      issueQueries.getProject("STK"),
      docQueries.getDoc(projectId, postmortemId),
      docQueries.ancestors(postmortemId),
      docQueries.linkedIssues(postmortemId),
      docQueries.listVersions(postmortemId),
      docQueries.listUsers(),
      issueQueries.listProjectKeys(),
      docQueries.supersedeOptions(projectId, postmortemId),
      docQueries.listTree(projectId),
      createFileQueries(db, { read }).listAttachments("doc", postmortemId),
      createCommentService(db, { runAtomic: transactionRunner(db), read }).listForDoc(postmortemId),
    ]);
    expect(flushes).toBe(1);
    expect(results.at(-1)).toHaveLength(2);
  });

  it("issue page with every P2 field (fix version, schedule, clone, incident): one round trip", async () => {
    const runAtomic = transactionRunner(db);
    const issueService = createIssueService(db, { runAtomic });
    const incidents = createIncidentService(db, { runAtomic });
    const release = await createReleaseService(db, { runAtomic }).createRelease(ada, {
      projectKey: "STK",
      name: "api-v9.10",
      releaseDate: null,
      description: null,
    });
    const issue = await issueService.createIssue(ada, {
      projectKey: "STK",
      type: "task",
      title: "Harden checkout",
      priority: 2,
      releaseId: release.id,
    });
    await issueService.updateIssueField(ada, {
      issueId: issue.id,
      field: "schedule",
      value: { startDate: "2026-07-01", dueDate: "2026-07-10" },
    });
    const clone = await issueService.cloneIssue(ada, { issueId: issue.id });
    const incident = await incidents.declareIncident(
      ada,
      declareIncidentInput.parse({ projectKey: "STK", title: "Checkout slow", severity: "sev3" }),
    );
    await incidents.linkFollowUp(ada, { incidentId: incident.id, issueKey: issue.key });

    let flushes = 0;
    const read: Read = createBatchedRead(
      () => Promise.reject(new Error("count only: run each query alone")),
      (flush) => {
        flushes += 1;
        setImmediate(flush);
      },
    );
    const issueQueries = createIssueQueries(db, { read });
    const issueId = issueIdByNumber(projectId, issue.number);
    // Exactly the reads `[projectKey]/issues/[key]/page.tsx` starts, plus the app layout.
    const results = await Promise.all([
      ...appLayoutReads(db, read, ada),
      issueQueries.getProject("STK"),
      issueQueries.getIssue(projectId, issue.number),
      issueQueries.getProjectMeta(projectId),
      issueQueries.listChildren(issueId),
      issueQueries.listLinks(issueId),
      issueQueries.listMentionedIn(issueId),
      createCommentService(db, { runAtomic, read }).listForIssue(issueId),
      issueQueries.listActivity(issueId),
      issueQueries.listProjectKeys(),
      issueQueries.listSubtaskParents(projectId, issueId),
      createDocQueries(db, { read }).docsLinkingTo(issueId),
      createGithubQueries(db, { read }).listDevelopment(issueId),
      createWatcherService(db, { read }).list(issueId),
      createFileQueries(db, { read }).listAttachments("issue", issueId),
      createIncidentQueries(db, { read }).incidentsLinkingTo(issueId),
    ]);
    expect(flushes).toBe(1);
    const page = await Promise.all([
      createIssueQueries(db).getIssue(projectId, issue.number),
      createIssueQueries(db).listActivity(issueId),
      createIssueQueries(db).listLinks(issueId),
    ]);
    expect(page[0]).toMatchObject({ releaseId: release.id, dueDate: "2026-07-10" });
    expect(page[1].entries.map((row) => row.action)).toContain("cloned");
    expect(JSON.stringify(page[2])).toContain(clone.key);
    expect(results.at(-1)).toEqual([
      expect.objectContaining({ key: `INC-${incident.number}`, title: "Checkout slow" }),
    ]);
  });

  it("the digest links incident_commander and comment_on_doc to the right paths", async () => {
    const now = new Date(Date.now() + 60_000);
    const last = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    await db.update(users).set({ notifyEmail: false });
    for (const userId of [ada, bob]) {
      await db
        .update(users)
        .set({ notifyEmail: true, lastDigestAt: last, digestFrequency: "daily" })
        .where(eq(users.id, userId));
    }
    const sent: EmailMessage[] = [];
    const job = createDigestJob({
      db,
      notificationQueries: createNotificationQueries(db),
      send: async (message) => {
        sent.push(message);
        return { ok: true, providerId: `msg_${sent.length}` };
      },
      config: { from: "HQ <hq@mail.example.test>", baseUrl: BASE },
      now: () => now,
      log: () => undefined,
    });
    expect(await job.run()).toMatchObject({ due: 2, sent: 2 });

    const [adaRow] = await db.select({ email: users.email }).from(users).where(eq(users.id, ada));
    const [bobRow] = await db.select({ email: users.email }).from(users).where(eq(users.id, bob));
    const mailTo = (email: string | undefined) =>
      sent.find((message) => email !== undefined && message.to.includes(email));
    const bobMail = mailTo(bobRow?.email);
    const adaMail = mailTo(adaRow?.email);

    // INC-1: Bob was made the commander; the incident page is `/STK/incidents/INC-<n>`.
    expect(bobMail?.text).toContain(`made you the commander of INC-${incidentNumber}`);
    expect(bobMail?.text).toContain(`${BASE}/STK/incidents/INC-${incidentNumber}\n`);
    expect(bobMail?.html).toContain(`href="${BASE}/STK/incidents/INC-${incidentNumber}"`);

    // DOC-11/13: Ada owns both generated docs; Bob's comments link to the comment itself.
    const adaComments = await createNotificationQueries(db).unreadInPeriod(
      ada,
      { after: last, upTo: now },
      50,
    );
    const onDocs = adaComments.items.filter((item) => item.type === "comment_on_doc");
    expect(onDocs.length).toBeGreaterThanOrEqual(4);
    for (const docId of [postmortemId, notesId]) {
      const item = onDocs.find((entry) => entry.target?.href === `/STK/docs/${docId}`);
      expect(item?.commentId).toBeTruthy();
      expect(adaMail?.text).toContain(`${BASE}/STK/docs/${docId}#comment-${item?.commentId}`);
      expect(adaMail?.html).toContain(`href="${BASE}/STK/docs/${docId}#comment-`);
    }
  });
});
