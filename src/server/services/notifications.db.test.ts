import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type RichTextDoc } from "@/lib/rich-text";
import { createBatchedRead, type Read } from "@/server/db/read-batch";
import { notifications, statuses, watchers } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createGithubWebhookHandler } from "@/server/github/webhook";
import { appLayoutReads } from "@/test/page-reads";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";
import {
  deliveryId,
  pullRequestPayload,
  TEST_WEBHOOK_SECRET,
  webhookRequest,
} from "@/test/github-fixtures";

import { createCommentService } from "./comments";
import { createDocService } from "./docs";
import { createGithubService } from "./github";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import { createMentionQueries } from "./mentions";
import { createNotificationQueries } from "./notification-queries";
import { createNotificationService } from "./notifications";
import { createPlanningQueries } from "./planning-queries";
import { createProfileService } from "./profile";
import { issueIdByNumber, projectIdByKey } from "./sql";
import { createWatcherService } from "./watchers";

/** A doc with a paragraph of text and @mentions of `ids`. */
function mentioning(text: string, ...ids: string[]): RichTextDoc {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text },
          ...ids.map((id) => ({ type: "mention", attrs: { id, label: "Someone" } })),
        ],
      },
    ],
  };
}

/** NTF-1, ISS-11 and MY-1 "Mentions" against real Postgres (HQ_DB_TESTS=1). */
describeDb("notifications, watchers and @mentions (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let ada: string;
  let bob: string;
  let cy: string;
  let statusIds: Map<string, string>;
  const issues = () => createIssueService(db, { runAtomic: transactionRunner(db) });
  const comments = () => createCommentService(db, { runAtomic: transactionRunner(db) });
  const docs = () => createDocService(db, { runAtomic: transactionRunner(db) });
  const service = () => createNotificationService(db);
  const queries = () => createNotificationQueries(db);
  const watcherService = () => createWatcherService(db);

  const newIssue = (
    actor: string,
    extra: { assigneeId?: string; description?: RichTextDoc } = {},
  ) =>
    issues().createIssue(actor, {
      projectKey: "STK",
      title: "Issue",
      type: "task",
      priority: 2,
      ...extra,
    });
  const inbox = (userId: string) =>
    db.select().from(notifications).where(eq(notifications.userId, userId));
  const watcherIds = async (issueId: string) =>
    (await db.select().from(watchers).where(eq(watchers.issueId, issueId)))
      .map((row) => row.userId)
      .sort();

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    ada = await createTestUser(db, "Ada");
    bob = await createTestUser(db, "Bob");
    cy = await createTestUser(db, "Cy");
    const rows = await db.select({ id: statuses.id, name: statuses.name }).from(statuses);
    statusIds = new Map(rows.map((row) => [row.name, row.id]));
  });

  afterAll(async () => {
    await testDb?.close();
  });

  describe("notify()", () => {
    it("writes one row per recipient, never for the actor, and dedupes retries", async () => {
      const issue = await newIssue(ada);
      const input = {
        type: "assigned" as const,
        recipients: [bob, cy, ada, bob.toUpperCase(), "not-a-uuid"],
        actorId: ada,
        entity: { type: "issue" as const, id: issue.id },
        meta: { note: "x" },
        dedupeKey: `test:${issue.id}`,
      };
      expect(await service().notify(input)).toEqual({ created: 2 });
      // A retry of the same event adds nothing.
      expect(await service().notify(input)).toEqual({ created: 0 });
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.entityId, issue.id));
      expect(rows.map((row) => row.userId).sort()).toEqual([bob, cy].sort());
      expect(rows.find((row) => row.userId === bob)).toMatchObject({
        type: "assigned",
        actorId: ada,
        meta: { note: "x" },
        dedupeKey: `test:${issue.id}:${bob}`,
        readAt: null,
      });
    });

    it("notifies nobody when only the actor or unknown users are left", async () => {
      const issue = await newIssue(ada);
      const entity = { type: "issue" as const, id: issue.id };
      expect(
        await service().notify({ type: "assigned", recipients: [ada], actorId: ada, entity }),
      ).toEqual({ created: 0 });
      expect(
        await service().notify({
          type: "assigned",
          recipients: [crypto.randomUUID()],
          actorId: ada,
          entity,
        }),
      ).toEqual({ created: 0 });
    });
  });

  describe("watchers (ISS-11)", () => {
    it("auto-watches the reporter and assignee on create, and the new assignee", async () => {
      const issue = await newIssue(ada, { assigneeId: bob });
      expect(await watcherIds(issue.id)).toEqual([ada, bob].sort());
      await issues().updateIssueField(ada, { issueId: issue.id, field: "assignee", value: cy });
      expect(await watcherIds(issue.id)).toEqual([ada, bob, cy].sort());
      // Unassigning adds nobody and removes nobody.
      await issues().updateIssueField(ada, { issueId: issue.id, field: "assignee", value: null });
      expect(await watcherIds(issue.id)).toEqual([ada, bob, cy].sort());
    });

    it("auto-watches commenters", async () => {
      const issue = await newIssue(ada);
      await comments().createComment(cy, { issueId: issue.id, body: mentioning("Hi") });
      expect(await watcherIds(issue.id)).toEqual([ada, cy].sort());
    });

    it("watches and unwatches for oneself, idempotently, live issues only", async () => {
      const issue = await newIssue(ada);
      await watcherService().setWatching(bob, { issueId: issue.id, watching: true });
      await watcherService().setWatching(bob, { issueId: issue.id, watching: true });
      expect((await watcherService().list(issue.id)).map((user) => user.name)).toEqual([
        "Ada",
        "Bob",
      ]);
      await watcherService().setWatching(ada, { issueId: issue.id, watching: false });
      expect(await watcherIds(issue.id)).toEqual([bob]);
      await issues().deleteIssue(ada, issue.id);
      await expect(
        watcherService().setWatching(cy, { issueId: issue.id, watching: true }),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });

  describe("events (NTF-1)", () => {
    it("assigned to you: on create and on assignment, never for self-assignment", async () => {
      const issue = await newIssue(ada, { assigneeId: bob });
      expect(await inbox(bob)).toContainEqual(
        expect.objectContaining({ type: "assigned", entityId: issue.id, actorId: ada }),
      );
      await issues().updateIssueField(ada, { issueId: issue.id, field: "assignee", value: cy });
      const [toCy] = (await inbox(cy)).filter((row) => row.entityId === issue.id);
      expect(toCy).toMatchObject({ type: "assigned", actorId: ada });
      // Re-saving the same assignee is no change: no second entry.
      await issues().updateIssueField(ada, { issueId: issue.id, field: "assignee", value: cy });
      expect((await inbox(cy)).filter((row) => row.entityId === issue.id)).toHaveLength(1);
      // Assigning yourself notifies nobody.
      await issues().updateIssueField(ada, { issueId: issue.id, field: "assignee", value: ada });
      expect((await inbox(ada)).filter((row) => row.entityId === issue.id)).toEqual([]);
    });

    it("@mentioned in a description: only newly mentioned users, never the author", async () => {
      const issue = await newIssue(ada, { description: mentioning("cc ", bob, ada) });
      const mentionsOf = async (userId: string) =>
        (await inbox(userId)).filter(
          (row) => row.type === "mentioned" && row.entityId === issue.id,
        );
      expect(await mentionsOf(bob)).toHaveLength(1);
      expect(await mentionsOf(ada)).toEqual([]);
      // Saving again with Bob still there and Cy added notifies only Cy.
      await issues().updateIssueField(ada, {
        issueId: issue.id,
        field: "description",
        value: mentioning("cc ", bob, cy),
      });
      expect(await mentionsOf(bob)).toHaveLength(1);
      expect(await mentionsOf(cy)).toHaveLength(1);
      // Removing Bob and adding him back does not notify him twice (one event per entity).
      await issues().updateIssueField(ada, {
        issueId: issue.id,
        field: "description",
        value: mentioning("cc ", cy),
      });
      await issues().updateIssueField(ada, {
        issueId: issue.id,
        field: "description",
        value: mentioning("cc ", cy, bob),
      });
      expect(await mentionsOf(bob)).toHaveLength(1);
    });

    it("@mentioned in a comment, and the issue's watchers hear about the comment", async () => {
      const issue = await newIssue(ada, { assigneeId: bob });
      const { id: commentId } = await comments().createComment(cy, {
        issueId: issue.id,
        body: mentioning("Look ", bob),
      });
      const forIssue = async (userId: string) =>
        (await inbox(userId)).filter((row) => row.entityId === issue.id);
      // Bob watches (assignee) AND is mentioned: he gets the mention only.
      expect((await forIssue(bob)).map((row) => row.type).sort()).toEqual([
        "assigned",
        "mentioned",
      ]);
      expect((await forIssue(bob)).find((row) => row.type === "mentioned")?.meta).toEqual({
        commentId,
      });
      // Ada (reporter, watcher) gets the comment; Cy (the commenter) gets nothing.
      expect(await forIssue(ada)).toEqual([
        expect.objectContaining({ type: "comment_on_watched", actorId: cy, meta: { commentId } }),
      ]);
      expect(await forIssue(cy)).toEqual([]);

      // Editing the comment notifies only users it newly mentions.
      await comments().editComment(cy, { commentId, body: mentioning("Look ", bob, ada) });
      expect((await forIssue(ada)).map((row) => row.type).sort()).toEqual([
        "comment_on_watched",
        "mentioned",
      ]);
      expect((await forIssue(bob)).filter((row) => row.type === "mentioned")).toHaveLength(1);
      // Someone else's edit changes nothing and notifies nobody.
      await expect(
        comments().editComment(bob, { commentId, body: mentioning("x ", cy) }),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(await forIssue(cy)).toEqual([]);
    });

    it("@mentioned in a doc: on the save that adds the mention only", async () => {
      const doc = await docs().createDoc(ada, { projectKey: "STK", title: "Plan", type: "page" });
      const save = (version: number, content: RichTextDoc) =>
        docs().saveDoc(ada, { docId: doc.id, baseVersion: version, content, snapshot: false });
      const first = await save(doc.version, mentioning("Hi ", bob));
      const inDoc = async () =>
        (await inbox(bob)).filter(
          (row) => row.entityId === doc.id && row.type === "mentioned_in_doc",
        );
      expect(await inDoc()).toHaveLength(1);
      if (first.status !== "saved") throw new Error("save conflicted");
      await save(first.version, mentioning("Hi again ", bob));
      expect(await inDoc()).toHaveLength(1);
      // A losing (stale) save writes nothing and notifies nobody.
      await save(doc.version, mentioning("Stale ", cy));
      expect((await inbox(cy)).filter((row) => row.entityId === doc.id)).toEqual([]);
    });

    it("a status change notifies the watchers but not the actor", async () => {
      const issue = await newIssue(ada, { assigneeId: bob });
      await issues().updateIssueField(bob, {
        issueId: issue.id,
        field: "status",
        value: statusIds.get("In Progress") ?? "",
      });
      const toAda = (await inbox(ada)).filter((row) => row.type === "status_on_watched");
      expect(toAda.filter((row) => row.entityId === issue.id)).toEqual([
        expect.objectContaining({
          actorId: bob,
          meta: { from: statusIds.get("Backlog"), to: statusIds.get("In Progress") },
        }),
      ]);
      expect(
        (await inbox(bob)).filter(
          (row) => row.type === "status_on_watched" && row.entityId === issue.id,
        ),
      ).toEqual([]);
    });

    it("a GitHub-driven move to Done notifies the watchers with no actor (GH-3)", async () => {
      const issue = await newIssue(ada, { assigneeId: bob });
      const handler = createGithubWebhookHandler({
        secret: () => TEST_WEBHOOK_SECRET,
        apply: (plan) => createGithubService(db).applyDelivery(plan),
        refresh: () => undefined,
        log: () => undefined,
      });
      const payload = pullRequestPayload({
        number: 901,
        action: "closed",
        state: "closed",
        merged: true,
        title: "Fix it",
        body: `Fixes ${issue.key}`,
        mergedBy: "rk-dev",
      });
      const delivery = deliveryId();
      expect((await handler(webhookRequest("pull_request", payload, { delivery }))).status).toBe(
        200,
      );
      // A redelivery changes nothing and notifies nobody again.
      await handler(webhookRequest("pull_request", payload, { delivery }));
      for (const userId of [ada, bob]) {
        const moves = (await inbox(userId)).filter(
          (row) => row.type === "status_on_watched" && row.entityId === issue.id,
        );
        expect(moves).toEqual([
          expect.objectContaining({
            actorId: null,
            meta: { from: statusIds.get("Backlog"), to: statusIds.get("Done"), source: "github" },
          }),
        ]);
      }
      const [view] = (await queries().latest(bob, 50)).filter(
        (row) =>
          row.type === "status_on_watched" &&
          row.target?.kind === "issue" &&
          row.target.key === issue.key,
      );
      expect(view).toMatchObject({
        actorName: null,
        fromGithub: true,
        statusFrom: "Backlog",
        statusTo: "Done",
      });
    });
  });

  describe("reading and marking (scoped to the recipient)", () => {
    let reader: string;
    let other: string;

    beforeAll(async () => {
      reader = await createTestUser(db, "Reader");
      other = await createTestUser(db, "Other");
      for (let index = 0; index < 3; index += 1) {
        await newIssue(other, { assigneeId: reader });
      }
      await newIssue(reader, { assigneeId: other });
    });

    it("counts unread, lists newest first with names resolved, and pages", async () => {
      expect(await queries().unreadCount(reader)).toBe(3);
      const latest = await queries().latest(reader, 20);
      expect(latest).toHaveLength(3);
      expect(latest[0]).toMatchObject({
        type: "assigned",
        actorName: "Other",
        fromGithub: false,
        read: false,
        target: {
          kind: "issue",
          title: "Issue",
          href: expect.stringMatching(/^\/STK\/issues\/STK-\d+$/),
        },
      });
      const times = latest.map((row) => row.createdAt.getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      const page1 = await queries().page(reader, 1, 2);
      const page2 = await queries().page(reader, 2, 2);
      expect(page1).toMatchObject({ page: 1, hasMore: true });
      expect(page1.items).toHaveLength(2);
      expect(page2).toMatchObject({ page: 2, hasMore: false });
      expect(page2.items.map((row) => row.id)).toEqual([latest[2]?.id]);
    });

    it("marks one read, then all; another user can neither read nor mark them", async () => {
      const [first] = await queries().latest(reader, 1);
      if (!first) throw new Error("no notification");
      // The other user's view never includes the reader's rows…
      expect((await queries().latest(other, 50)).map((row) => row.id)).not.toContain(first.id);
      // …and marking one of them fails as "not found", changing nothing.
      await expect(service().markRead(other, first.id)).rejects.toMatchObject({
        code: "not_found",
      });
      expect(await queries().unreadCount(reader)).toBe(3);
      await service().markRead(reader, first.id);
      await service().markRead(reader, first.id);
      expect(await queries().unreadCount(reader)).toBe(2);
      expect((await queries().latest(reader, 20)).find((row) => row.id === first.id)?.read).toBe(
        true,
      );
      // "Mark all read" by the other user leaves the reader's alone.
      const otherUnread = await queries().unreadCount(other);
      expect(otherUnread).toBeGreaterThan(0);
      expect(await service().markAllRead(other, new Date())).toEqual({ marked: otherUnread });
      expect(await queries().unreadCount(reader)).toBe(2);
      // Only what the list showed (created up to `asOf`): a newer entry stays unread.
      const { asOf } = await queries().page(reader, 1, 30);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await newIssue(other, { assigneeId: reader });
      expect(await queries().unreadCount(reader)).toBe(3);
      expect(await service().markAllRead(reader, asOf)).toEqual({ marked: 2 });
      expect(await queries().unreadCount(reader)).toBe(1);
      expect(await service().markAllRead(reader, new Date())).toEqual({ marked: 1 });
      expect(await queries().unreadCount(reader)).toBe(0);
    });

    it("hides the target of a deleted issue", async () => {
      const issue = await newIssue(other, { assigneeId: reader });
      await issues().deleteIssue(other, issue.id);
      const [entry] = (await queries().latest(reader, 50)).filter((row) => row.target === null);
      expect(entry).toMatchObject({ type: "assigned", target: null });
    });
  });

  it("stores the NTF-2 email opt-in for the user only", async () => {
    expect(await queries().notifyEmail(bob)).toBe(false);
    expect(await service().setNotifyEmail(bob, true)).toEqual({ notifyEmail: true });
    expect(await queries().notifyEmail(bob)).toBe(true);
    expect(await queries().notifyEmail(cy)).toBe(false);
  });

  it("My Work → Mentions: others' mentions of me in issues, comments and docs", async () => {
    const me = await createTestUser(db, "Me");
    const issue = await newIssue(ada, { description: mentioning("cc ", me) });
    await comments().createComment(bob, { issueId: issue.id, body: mentioning("ping ", me) });
    const doc = await docs().createDoc(ada, { projectKey: "STK", title: "Spec", type: "page" });
    await docs().saveDoc(ada, {
      docId: doc.id,
      baseVersion: doc.version,
      content: mentioning("see ", me),
      snapshot: false,
    });
    // A self-mention is left out.
    await newIssue(me, { description: mentioning("note to self ", me) });
    const mentions = await createMentionQueries(db).listMentionsOf(me, 10);
    expect(mentions.map((item) => [item.source, item.mentionedByName])).toEqual([
      ["doc", "Ada"],
      ["comment", "Bob"],
      ["issue", "Ada"],
    ]);
    expect(mentions[0]?.target).toEqual({
      kind: "doc",
      title: "Spec",
      href: `/STK/docs/${doc.id}`,
    });
    expect(mentions[1]?.target).toMatchObject({ kind: "issue", key: issue.key });
    // A deleted issue drops out (its comment too).
    await issues().deleteIssue(ada, issue.id);
    expect(
      (await createMentionQueries(db).listMentionsOf(me, 10)).map((item) => item.source),
    ).toEqual(["doc"]);
  });

  describe("round trips (README Performance)", () => {
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
    // The app layout's reads (templates, sprint options, sidebar views, the bell's count).
    const layout = (read: Read, userId: string) => appLayoutReads(db, read, userId);

    it("my work (with Mentions): one round trip", async () => {
      const { read, trips } = counted();
      const planning = createPlanningQueries(db, { read });
      await Promise.all([
        ...layout(read, ada),
        planning.listAssignedTo(ada),
        planning.listRecentlyViewed(ada),
        createMentionQueries(db, { read }).listMentionsOf(ada, 10),
      ]);
      expect(trips()).toBe(1);
    });

    it("notifications page: one round trip", async () => {
      const { read, trips } = counted();
      const q = createNotificationQueries(db, { read });
      await Promise.all([...layout(read, ada), q.page(ada, 1, 30), q.unreadCount(ada)]);
      expect(trips()).toBe(1);
    });

    it("profile (with the notification setting): one round trip", async () => {
      const { read, trips } = counted();
      await Promise.all([
        ...layout(read, ada),
        createProfileService(db, { read }).get(ada),
        createNotificationQueries(db, { read }).notifyEmail(ada),
      ]);
      expect(trips()).toBe(1);
    });

    it("issue page (with watchers): one round trip", async () => {
      const issue = await newIssue(ada);
      const { read, trips } = counted();
      const projectId = projectIdByKey("STK");
      const issueId = issueIdByNumber(projectId, issue.number);
      const q = createIssueQueries(db, { read });
      const [, , , , , detail, watching] = await Promise.all([
        ...layout(read, ada),
        q.getProject("STK"),
        q.getIssue(projectId, issue.number),
        createWatcherService(db, { read }).list(issueId),
        q.listActivity(issueId),
      ]);
      expect(trips()).toBe(1);
      expect(detail?.id).toBe(issue.id);
      expect(watching.map((user) => user.id)).toEqual([ada]);
    });
  });
});
