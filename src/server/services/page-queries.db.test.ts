import { afterAll, beforeAll, expect, it } from "vitest";

import { EMPTY_FILTERS } from "@/lib/issues/filters";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createCommentService } from "./comments";
import { createDocQueries } from "./doc-queries";
import { createDocService } from "./docs";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import { createPlanningQueries } from "./planning-queries";
import { issueIdByNumber, projectIdByKey } from "./sql";

/**
 * The one-round-trip page loads (HQ_DB_TESTS=1): queries that take the project by key and
 * the issue by number (`IdRef` subqueries) return exactly what the id-based calls return,
 * and the single-statement rewrites (labels as json, links joined to the other issue,
 * activity keys, type-gated pickers) keep their results.
 */
describeDb("page queries by reference (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let projectId: string;
  const issueService = () => createIssueService(db, { runAtomic: transactionRunner(db) });
  const issueQueries = () => createIssueQueries(db);
  const docService = () => createDocService(db, { runAtomic: transactionRunner(db) });
  const docQueries = () => createDocQueries(db);
  const stk = () => projectIdByKey("STK");

  let epic: { id: string; number: number; key: string };
  let story: { id: string; number: number; key: string };
  let other: { id: string; number: number; key: string };
  let subtask: { id: string; number: number; key: string };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    projectId = (await seed(db)).projectId;
    actor = await createTestUser(db, "Ada Actor");
    const create = (title: string, type: "epic" | "story" | "task", parentId?: string) =>
      issueService().createIssue(actor, {
        projectKey: "STK",
        title,
        type,
        priority: 2,
        parentId,
      });
    epic = await create("Epic", "epic");
    story = await create("Story", "story");
    other = await create("Other", "task");
    subtask = await issueService().createIssue(actor, {
      projectKey: "STK",
      title: "Sub",
      type: "subtask",
      priority: 2,
      parentId: story.id,
    });
    await issueService().addLabel(actor, { issueId: story.id, name: "zeta" });
    await issueService().addLabel(actor, { issueId: story.id, name: "alpha" });
    await issueService().addLink(actor, {
      issueId: story.id,
      relation: "blocks",
      targetKey: other.key,
    });
    await issueService().updateIssueField(actor, {
      issueId: story.id,
      field: "parent",
      value: epic.id,
    });
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("loads the issue page by key and number exactly as by id", async () => {
    const q = issueQueries();
    const comments = createCommentService(db, { runAtomic: transactionRunner(db) });
    const byRef = issueIdByNumber(stk(), story.number);
    expect(await q.getIssue(stk(), story.number)).toEqual(
      await q.getIssue(projectId, story.number),
    );
    expect(await q.getProjectMeta(stk())).toEqual(await q.getProjectMeta(projectId));
    expect(await q.listChildren(byRef)).toEqual(await q.listChildren(story.id));
    expect(await q.listLinks(byRef)).toEqual(await q.listLinks(story.id));
    expect(await q.listMentionedIn(byRef)).toEqual(await q.listMentionedIn(story.id));
    expect(await q.listActivity(byRef)).toEqual(await q.listActivity(story.id));
    expect(await comments.listForIssue(byRef)).toEqual(await comments.listForIssue(story.id));
    expect(await docQueries().docsLinkingTo(byRef)).toEqual(
      await docQueries().docsLinkingTo(story.id),
    );
  });

  it("returns labels from the json column, sorted by name", async () => {
    const detail = await issueQueries().getIssue(stk(), story.number);
    expect(detail?.labels.map((label) => label.name)).toEqual(["alpha", "zeta"]);
    const list = await createPlanningQueries(db).listIssues(stk(), {
      scope: "all",
      filters: EMPTY_FILTERS,
      currentUserId: actor,
    });
    expect(list.find((row) => row.id === story.id)?.labels.map((label) => label.name)).toEqual([
      "alpha",
      "zeta",
    ]);
    expect(list.find((row) => row.id === other.id)?.labels).toEqual([]);
  });

  it("words links from either end in one statement", async () => {
    const [fromStory] = await issueQueries().listLinks(story.id);
    expect(fromStory).toMatchObject({ relation: "blocks", issue: { key: other.key } });
    const [fromOther] = await issueQueries().listLinks(other.id);
    expect(fromOther).toMatchObject({ relation: "is_blocked_by", issue: { key: story.key } });
  });

  it("resolves the issue keys mentioned by the activity (parent changes)", async () => {
    const { issueKeys } = await issueQueries().listActivity(story.id);
    expect(issueKeys[epic.id]).toBe(epic.key);
  });

  it("offers subtask parents only when the issue is a subtask", async () => {
    expect(await issueQueries().listSubtaskParents(stk(), story.id)).toEqual([]);
    const parents = await issueQueries().listSubtaskParents(stk(), subtask.id);
    const keys = parents.map((parent) => parent.key);
    expect(keys).toEqual(expect.arrayContaining([story.key, other.key]));
    expect(keys).not.toContain(epic.key);
    expect(keys).not.toContain(subtask.key);
  });

  it("returns nothing (instead of failing) for an unknown project key", async () => {
    const missing = projectIdByKey("NOPE");
    expect(await issueQueries().getProject("NOPE")).toBeNull();
    expect(await issueQueries().getIssue(missing, story.number)).toBeNull();
    expect(await docQueries().listTree(missing)).toEqual([]);
    expect(await docQueries().listAdrs(missing)).toEqual([]);
  });

  it("offers other ADRs as successors only for an ADR", async () => {
    const first = await docService().createAdr(actor, { projectKey: "STK", title: "First" });
    const second = await docService().createAdr(actor, { projectKey: "STK", title: "Second" });
    const page = await docService().createDoc(actor, {
      projectKey: "STK",
      title: "A page",
      type: "page",
    });
    expect(await docQueries().supersedeOptions(stk(), page.id)).toEqual([]);
    const options = await docQueries().supersedeOptions(stk(), first.id);
    expect(options.map((option) => option.id)).toContain(second.id);
    expect(options.map((option) => option.id)).not.toContain(first.id);
    expect(await docQueries().listAdrs(stk())).toEqual(await docQueries().listAdrs(projectId));
  });
});
