import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { createBatchedRead, type Read } from "@/server/db/read-batch";
import {
  activity,
  githubDeliveries,
  githubRefs,
  issues,
  statuses,
  users,
} from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createGithubWebhookHandler } from "@/server/github/webhook";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";
import {
  commit,
  createPayload,
  deliveryId,
  pullRequestPayload,
  pushPayload,
  sha,
  TEST_WEBHOOK_SECRET,
  webhookRequest,
} from "@/test/github-fixtures";

import { createCommentService } from "./comments";
import { createDocQueries } from "./doc-queries";
import { createGithubService } from "./github";
import { createGithubQueries } from "./github-queries";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import { issueIdByNumber, projectIdByKey } from "./sql";

/** GH-1…GH-4 against real Postgres: signed request → handler → one statement → rows. */
describeDb("GitHub webhook (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let statusIds: Map<string, string>;
  const issueService = () => createIssueService(db, { runAtomic: transactionRunner(db) });
  const handler = () =>
    createGithubWebhookHandler({
      secret: () => TEST_WEBHOOK_SECRET,
      apply: (plan) => createGithubService(db).applyDelivery(plan),
      refresh: () => undefined,
      log: () => undefined,
    });
  const send = async (event: string, payload: unknown, delivery = deliveryId()) => {
    const response = await handler()(webhookRequest(event, payload, { delivery }));
    expect(response.status).toBe(200);
    return response.json();
  };

  async function newIssue(title = "Issue") {
    return issueService().createIssue(actor, {
      projectKey: "STK",
      title,
      type: "task",
      priority: 2,
    });
  }
  async function statusName(issueId: string) {
    const [row] = await db
      .select({ name: statuses.name, resolvedAt: issues.resolvedAt })
      .from(issues)
      .innerJoin(statuses, eq(statuses.id, issues.statusId))
      .where(eq(issues.id, issueId));
    return row;
  }
  const setStatus = (issueId: string, name: string) =>
    issueService().updateIssueField(actor, {
      issueId,
      field: "status",
      value: statusIds.get(name) ?? "",
    });
  const refsOf = (issueId: string) =>
    db
      .select()
      .from(githubRefs)
      .where(eq(githubRefs.issueId, issueId))
      .orderBy(asc(githubRefs.kind), asc(githubRefs.createdAt));
  const statusActivity = (issueId: string) =>
    db
      .select()
      .from(activity)
      .where(and(eq(activity.entityId, issueId), eq(activity.field, "status")));

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
    const rows = await db.select({ id: statuses.id, name: statuses.name }).from(statuses);
    statusIds = new Map(rows.map((row) => [row.name, row.id]));
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("links a push's branch and commits idempotently", async () => {
    const issue = await newIssue();
    const branch = `refs/heads/${issue.key.toLowerCase()}-oom-ocr`;
    const commits = [commit(`${issue.key}: first`), commit(`fix ${issue.key.toLowerCase()} again`)];
    const payload = pushPayload({ ref: branch, commits });
    expect(await send("push", payload)).toMatchObject({ linked: 3 });
    // The same push again under a NEW delivery id (e.g. pushed to another branch): no dupes.
    expect(await send("push", payload)).toMatchObject({ linked: 0 });
    const refs = await refsOf(issue.id);
    expect(refs.map((ref) => ref.kind).sort()).toEqual(["branch", "commit", "commit"]);
    expect(refs.find((ref) => ref.kind === "branch")).toMatchObject({
      refName: `${issue.key.toLowerCase()}-oom-ocr`,
      repo: "Stockkart/inventory-api",
      state: null,
    });
    // Linking never changes the status.
    expect((await statusName(issue.id))?.name).toBe("Backlog");
  });

  it("links a created branch, and ignores unknown issue keys", async () => {
    const issue = await newIssue();
    await send("create", createPayload(`${issue.key.toLowerCase()}-x`));
    await send("create", createPayload("stk-999999-nope"));
    expect(await refsOf(issue.id)).toHaveLength(1);
  });

  it("dedupes a redelivery by X-GitHub-Delivery", async () => {
    const issue = await newIssue();
    const delivery = deliveryId();
    const payload = pushPayload({ commits: [commit(`${issue.key} work`)] });
    expect(await send("push", payload, delivery)).toMatchObject({ linked: 1 });
    expect(await send("push", payload, delivery)).toMatchObject({ duplicate: true });
    const [row] = await db
      .select()
      .from(githubDeliveries)
      .where(eq(githubDeliveries.deliveryId, delivery));
    expect(row?.event).toBe("push");
  });

  it("prunes deliveries older than 30 days", async () => {
    await db.insert(githubDeliveries).values({
      deliveryId: "old-delivery",
      event: "push",
      receivedAt: new Date(Date.now() - 31 * 24 * 3600 * 1000),
    });
    const issue = await newIssue();
    await send("push", pushPayload({ commits: [commit(`${issue.key}`)] }));
    const left = await db
      .select()
      .from(githubDeliveries)
      .where(eq(githubDeliveries.deliveryId, "old-delivery"));
    expect(left).toEqual([]);
  });

  it("links at most 100 commits per push", async () => {
    const issue = await newIssue();
    const commits = Array.from({ length: 120 }, () => commit(`${issue.key} step`));
    expect(await send("push", pushPayload({ ref: "refs/heads/main", commits }))).toMatchObject({
      linked: 100,
    });
  });

  it("PR opened links but does NOT change the status", async () => {
    const issue = await newIssue();
    await setStatus(issue.id, "In Progress");
    await send("pull_request", pullRequestPayload({ number: 201, title: `${issue.key} work` }));
    expect((await statusName(issue.id))?.name).toBe("In Progress");
    const [pr] = await refsOf(issue.id);
    expect(pr).toMatchObject({ kind: "pr", number: 201, state: "open", authorLogin: "imf-ali" });
  });

  it("updates the state on every action; closed unmerged changes only the state", async () => {
    const issue = await newIssue();
    const title = `${issue.key} draft work`;
    const pr = { number: 202, title, body: `Fixes ${issue.key}` };
    await send("pull_request", pullRequestPayload({ ...pr, draft: true }));
    expect((await refsOf(issue.id))[0]?.state).toBe("draft");
    await send("pull_request", pullRequestPayload({ ...pr, action: "ready_for_review" }));
    expect((await refsOf(issue.id))[0]?.state).toBe("open");
    await send("pull_request", pullRequestPayload({ ...pr, action: "closed", state: "closed" }));
    expect((await refsOf(issue.id))[0]?.state).toBe("closed");
    await send("pull_request", pullRequestPayload({ ...pr, action: "reopened" }));
    expect((await refsOf(issue.id))[0]?.state).toBe("open");
    expect((await statusName(issue.id))?.name).toBe("Backlog");
    expect(await statusActivity(issue.id)).toEqual([]);
    expect(await refsOf(issue.id)).toHaveLength(1);
  });

  it("keeps PR rows current after the key leaves the title", async () => {
    const issue = await newIssue();
    await send("pull_request", pullRequestPayload({ number: 203, title: `${issue.key} x` }));
    await send(
      "pull_request",
      pullRequestPayload({ number: 203, title: "renamed", action: "closed", state: "closed" }),
    );
    expect((await refsOf(issue.id))[0]).toMatchObject({ title: "renamed", state: "closed" });
  });

  it("merged into the default branch with 'Fixes' moves each issue to Done with activity", async () => {
    const one = await newIssue();
    const two = await newIssue();
    await setStatus(one.id, "In Review");
    const result = await send(
      "pull_request",
      pullRequestPayload({
        number: 118,
        action: "closed",
        state: "closed",
        merged: true,
        title: "OCR pool",
        body: `Fixes ${one.key}, ${two.key.toLowerCase()}`,
        mergedBy: "rk-dev",
      }),
    );
    expect(result).toMatchObject({ moved: 2 });
    for (const issue of [one, two]) {
      const status = await statusName(issue.id);
      expect(status?.name).toBe("Done");
      expect(status?.resolvedAt).toBeInstanceOf(Date);
      expect((await refsOf(issue.id))[0]).toMatchObject({ state: "merged" });
    }
    const entry = (await statusActivity(one.id)).find((row) => row.actorId === null);
    expect(entry).toMatchObject({
      actorId: null,
      action: "updated",
      fromValue: statusIds.get("In Review"),
      toValue: statusIds.get("Done"),
      meta: { source: "github", repo: "Stockkart/inventory-api", pr: 118, mergedBy: "rk-dev" },
    });
  });

  it("leaves an issue that is already done unchanged", async () => {
    const issue = await newIssue();
    await setStatus(issue.id, "Won't Do");
    const before = await statusActivity(issue.id);
    await send(
      "pull_request",
      pullRequestPayload({
        number: 204,
        action: "closed",
        state: "closed",
        merged: true,
        body: `Closes ${issue.key}`,
      }),
    );
    expect((await statusName(issue.id))?.name).toBe("Won't Do");
    expect(await statusActivity(issue.id)).toHaveLength(before.length);
  });

  it("merged into a non-default branch, or without a keyword, only links", async () => {
    const issue = await newIssue();
    const merged = { action: "closed", state: "closed" as const, merged: true };
    await send(
      "pull_request",
      pullRequestPayload({ ...merged, number: 205, base: "release", body: `Fixes ${issue.key}` }),
    );
    await send("pull_request", pullRequestPayload({ ...merged, number: 206, body: issue.key }));
    expect((await statusName(issue.id))?.name).toBe("Backlog");
    expect((await refsOf(issue.id)).map((ref) => ref.state)).toEqual(["merged", "merged"]);
  });

  it("never moves a PR's state backwards on a late (older) event, and keeps merged", async () => {
    const issue = await newIssue();
    const pr = { number: 207, title: `${issue.key} work` };
    const opened = pullRequestPayload({ ...pr, updatedAt: "2026-03-01T10:00:00Z" });
    await send(
      "pull_request",
      pullRequestPayload({
        ...pr,
        action: "closed",
        state: "closed",
        merged: true,
        updatedAt: "2026-03-01T11:00:00Z",
      }),
    );
    await send("pull_request", opened);
    expect((await refsOf(issue.id))[0]).toMatchObject({ state: "merged" });
    // Even a "newer" open event cannot un-merge it.
    await send(
      "pull_request",
      pullRequestPayload({ ...pr, action: "edited", updatedAt: "2026-03-02T00:00:00Z" }),
    );
    expect((await refsOf(issue.id))[0]).toMatchObject({ state: "merged" });
  });

  it("closes once per merge: a replayed merge under a new delivery id does not re-close", async () => {
    const issue = await newIssue();
    const merge = pullRequestPayload({
      number: 208,
      action: "closed",
      state: "closed",
      merged: true,
      body: `Fixes ${issue.key}`,
    });
    expect(await send("pull_request", merge)).toMatchObject({ moved: 1 });
    // Someone reopens the issue; the same signed body is sent again with a fresh GUID.
    await setStatus(issue.id, "In Progress");
    expect(await send("pull_request", merge)).toMatchObject({ moved: 0 });
    expect((await statusName(issue.id))?.name).toBe("In Progress");
    expect((await statusActivity(issue.id)).filter((row) => row.actorId === null)).toHaveLength(1);
  });

  it("still closes when another event of the merged PR arrived before 'closed'", async () => {
    const issue = await newIssue();
    const merged = {
      number: 209,
      state: "closed" as const,
      merged: true,
      body: `Fixes ${issue.key}`,
    };
    await send("pull_request", pullRequestPayload({ ...merged, action: "labeled" }));
    expect((await statusName(issue.id))?.name).toBe("Backlog");
    expect(
      await send("pull_request", pullRequestPayload({ ...merged, action: "closed" })),
    ).toMatchObject({ moved: 1 });
  });

  it("ignores repositories outside Stockkart", async () => {
    const issue = await newIssue();
    await send(
      "pull_request",
      pullRequestPayload({
        repo: "Evil/inventory-api",
        action: "closed",
        state: "closed",
        merged: true,
        body: `Fixes ${issue.key}`,
      }),
    );
    expect(await refsOf(issue.id)).toEqual([]);
    expect((await statusName(issue.id))?.name).toBe("Backlog");
  });

  it("lists the Development panel in one statement, mapping authors to HQ users", async () => {
    const issue = await newIssue();
    const userId = await createTestUser(db, "Imf Ali");
    await db.update(users).set({ githubLogin: "Imf-Ali" }).where(eq(users.id, userId));
    const shaOne = sha();
    await send(
      "push",
      pushPayload({
        ref: `refs/heads/${issue.key.toLowerCase()}-x`,
        commits: [
          commit(`${issue.key} one\n\nbody`, shaOne),
          commit(`${issue.key} two`, sha(), null),
        ],
      }),
    );
    await send(
      "pull_request",
      pullRequestPayload({ number: 300, title: `${issue.key} pr`, author: "someone" }),
    );

    let reads = 0;
    const read: Read = (query) => {
      reads += 1;
      return Promise.resolve(query);
    };
    const queries = createGithubQueries(db, { read });
    const view = await queries.listDevelopment(
      issueIdByNumber(projectIdByKey("STK"), issue.number),
    );
    expect(reads).toBe(1);
    expect(view.branches).toEqual([
      expect.objectContaining({
        name: `${issue.key.toLowerCase()}-x`,
        repo: "Stockkart/inventory-api",
      }),
    ]);
    expect(view.pullRequests).toEqual([
      expect.objectContaining({
        number: 300,
        state: "open",
        author: { login: "someone", user: null },
      }),
    ]);
    expect(view.commits).toHaveLength(2);
    const first = view.commits.find((item) => item.sha === shaOne);
    expect(first).toMatchObject({
      message: `${issue.key} one`,
      author: { login: "imf-ali", user: { id: userId, name: "Imf Ali" } },
    });
  });

  it("keeps the issue page, Development panel included, at ONE batched round trip", async () => {
    const issue = await newIssue();
    await send("create", createPayload(`${issue.key.toLowerCase()}-x`));
    let batches = 0;
    const read = createBatchedRead(async (queries) => {
      batches += 1;
      const results: unknown[] = [];
      for (const query of queries) results.push(await query);
      return results;
    });
    const options = { read, runAtomic: transactionRunner(db) };
    const issueQueries = createIssueQueries(db, options);
    const projectId = projectIdByKey("STK");
    const issueId = issueIdByNumber(projectId, issue.number);
    // The same fan-out as app/(app)/[projectKey]/issues/[key]/page.tsx.
    const results = await Promise.all([
      issueQueries.getProject("STK"),
      issueQueries.getIssue(projectId, issue.number),
      issueQueries.getProjectMeta(projectId),
      issueQueries.listChildren(issueId),
      issueQueries.listLinks(issueId),
      issueQueries.listMentionedIn(issueId),
      createCommentService(db, options).listForIssue(issueId),
      issueQueries.listActivity(issueId),
      issueQueries.listProjectKeys(),
      issueQueries.listSubtaskParents(projectId, issueId),
      createDocQueries(db, options).docsLinkingTo(issueId),
      createGithubQueries(db, options).listDevelopment(issueId),
    ]);
    expect(batches).toBe(1);
    expect(results.at(-1)).toMatchObject({ branches: [{ name: `${issue.key.toLowerCase()}-x` }] });
  });
});
