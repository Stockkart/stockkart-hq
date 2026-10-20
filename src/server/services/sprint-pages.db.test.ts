import { afterAll, beforeAll, expect, it } from "vitest";

import { EMPTY_FILTERS } from "@/lib/issues/filters";
import { createBatchedRead, type Read } from "@/server/db/read-batch";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createCommentService } from "./comments";
import { createDocQueries } from "./doc-queries";
import { createGithubQueries } from "./github-queries";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import { createPlanningQueries } from "./planning-queries";
import { createPlanningService } from "./planning";
import { createSprintQueries } from "./sprint-queries";
import { createSprintService } from "./sprints";
import { issueIdByNumber, projectIdByKey } from "./sql";

/**
 * README "Performance": every page loads in ONE database round trip. On Neon a round trip
 * is one `db.batch()` flush of the request's `read()` queue; node-postgres has no batch, so
 * here the batch "fails" on purpose and each query runs on its own (the batcher's error
 * path), while the number of flushes (= round trips on Neon) is counted. Each block below
 * starts exactly the reads its page (plus the app layout) starts, as `Promise.all`.
 */
describeDb("round trips of the sprint-related pages (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let sprintId: string;
  let issueNumber: number;

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
      planningQueries: createPlanningQueries(db, { read }),
      sprintQueries: createSprintQueries(db, { read }),
      commentService: createCommentService(db, { runAtomic: transactionRunner(db), read }),
      docQueries: createDocQueries(db, { read }),
      githubQueries: createGithubQueries(db, { read }),
    };
  }

  /** The app layout's reads (quick-create templates and sprint options). */
  const layout = (s: ReturnType<typeof services>) =>
    [s.issueQueries.issueTemplates(), s.sprintQueries.openSprintOptionsByProject()] as const;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
    const issueService = createIssueService(db, { runAtomic: transactionRunner(db) });
    const sprintService = createSprintService(db, { runAtomic: transactionRunner(db) });
    const created = await issueService.createIssue(actor, {
      projectKey: "STK",
      title: "In the sprint",
      type: "task",
      priority: 2,
    });
    issueNumber = created.number;
    sprintId = (
      await sprintService.createSprint(actor, {
        projectKey: "STK",
        name: "Sprint 1",
        goal: null,
        startDate: "2026-06-01",
        endDate: "2026-06-14",
      })
    ).id;
    await createPlanningService(db).moveIssueToSprint(actor, { issueId: created.id, sprintId });
    await sprintService.startSprint(actor, sprintId);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  const projectId = () => projectIdByKey("STK");
  const options = { filters: EMPTY_FILTERS, currentUserId: "" };

  it("backlog: one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    await Promise.all([
      ...layout(s),
      s.issueQueries.getProject("STK"),
      s.planningQueries.listIssues(projectId(), { ...options, scope: "planning" }),
      s.issueQueries.getProjectMeta(projectId()),
      s.sprintQueries.listSprints(projectId()),
    ]);
    expect(trips()).toBe(1);
  });

  it.each(["board_sprint", "board"] as const)("board (%s): one round trip", async (scope) => {
    const { read, trips } = counted();
    const s = services(read);
    const [, , , issues] = await Promise.all([
      ...layout(s),
      s.issueQueries.getProject("STK"),
      s.planningQueries.listIssues(projectId(), { ...options, scope }),
      s.issueQueries.getProjectMeta(projectId()),
      s.sprintQueries.getActiveSprint(projectId()),
    ]);
    expect(trips()).toBe(1);
    expect(Array.isArray(issues)).toBe(true);
  });

  it("sprints: one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    await Promise.all([
      ...layout(s),
      s.issueQueries.getProject("STK"),
      s.sprintQueries.listSprints(projectId()),
      s.sprintQueries.burndownInputs(
        projectId(),
        s.sprintQueries.activeAndRecentClosed(projectId()),
      ),
    ]);
    expect(trips()).toBe(1);
  });

  it("sprint page: one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const [, , , , inputs, issues] = await Promise.all([
      ...layout(s),
      s.issueQueries.getProject("STK"),
      s.sprintQueries.listSprints(projectId()),
      s.sprintQueries.burndownInputs(projectId(), s.sprintQueries.oneSprint(projectId(), sprintId)),
      s.planningQueries.listIssues(projectId(), { ...options, scope: "all", sprintId }),
    ]);
    expect(trips()).toBe(1);
    expect(inputs.timelines).toHaveLength(1);
    expect(issues).toHaveLength(1);
  });

  it("issue page (Sprint field and Development panel): one round trip", async () => {
    const { read, trips } = counted();
    const s = services(read);
    const issueId = issueIdByNumber(projectId(), issueNumber);
    const [, , , issue, meta] = await Promise.all([
      ...layout(s),
      s.issueQueries.getProject("STK"),
      s.issueQueries.getIssue(projectId(), issueNumber),
      s.issueQueries.getProjectMeta(projectId()),
      s.issueQueries.listChildren(issueId),
      s.issueQueries.listLinks(issueId),
      s.issueQueries.listMentionedIn(issueId),
      s.commentService.listForIssue(issueId),
      s.issueQueries.listActivity(issueId),
      s.issueQueries.listProjectKeys(),
      s.issueQueries.listSubtaskParents(projectId(), issueId),
      s.docQueries.docsLinkingTo(issueId),
      s.githubQueries.listDevelopment(issueId),
    ]);
    expect(trips()).toBe(1);
    expect(issue?.sprintId).toBe(sprintId);
    expect(meta.sprints).toEqual([{ id: sprintId, name: "Sprint 1", state: "active" }]);
  });
});
