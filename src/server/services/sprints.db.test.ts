import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { EMPTY_FILTERS } from "@/lib/issues/filters";
import { computeBurndown, computeVelocity } from "@/lib/sprints/burndown";
import { addDays, isoDateOf } from "@/lib/sprints/dates";
import { activity, issues, projects, sprints, statuses } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { ServiceError } from "./errors";
import { createIssueService } from "./issues";
import { createPlanningService } from "./planning";
import { createPlanningQueries } from "./planning-queries";
import { createSprintQueries } from "./sprint-queries";
import { createSprintService } from "./sprints";

/** SPR-1/2/3/4, BLG-3 and BRD-3 against real Postgres (synthetic data only, S-7). */
describeDb("sprints (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let projectId: string;
  const runAtomic = () => transactionRunner(db);
  const issueService = () => createIssueService(db, { runAtomic: runAtomic() });
  const sprintService = () => createSprintService(db, { runAtomic: runAtomic() });
  const planning = () => createPlanningService(db);
  const queries = () => createSprintQueries(db);
  const planningQueries = () => createPlanningQueries(db);

  const status = async (name: string) => {
    const [row] = await db
      .select({ id: statuses.id })
      .from(statuses)
      .where(and(eq(statuses.projectId, projectId), eq(statuses.name, name)));
    if (!row) throw new Error(`no status ${name}`);
    return row.id;
  };

  const createIssue = async (title: string, points: number | null = null) => {
    const { id } = await issueService().createIssue(actor, {
      projectKey: "STK",
      title,
      type: "task",
      priority: 2,
    });
    if (points !== null) {
      await issueService().updateIssueField(actor, {
        issueId: id,
        field: "storyPoints",
        value: points,
      });
    }
    return id;
  };

  const setStatus = async (issueId: string, name: string) =>
    issueService().updateIssueField(actor, { issueId, field: "status", value: await status(name) });

  const addToSprint = (issueId: string, sprintId: string | null) =>
    planning().moveIssueToSprint(actor, { issueId, sprintId });

  const createSprint = async (name: string, startDate = "2026-06-01", endDate = "2026-06-14") =>
    (
      await sprintService().createSprint(actor, {
        projectKey: "STK",
        name,
        goal: null,
        startDate,
        endDate,
      })
    ).id;

  const sprintOf = async (issueId: string) => {
    const [row] = await db
      .select({ sprintId: issues.sprintId })
      .from(issues)
      .where(eq(issues.id, issueId));
    return row?.sprintId ?? null;
  };

  const sprintActivity = (sprintId: string, action: string) =>
    db
      .select({ meta: activity.meta, createdAt: activity.createdAt })
      .from(activity)
      .where(
        and(
          eq(activity.entityType, "sprint"),
          eq(activity.entityId, sprintId),
          eq(activity.action, action),
        ),
      );

  const issueSprintChanges = (issueId: string) =>
    db
      .select({ from: activity.fromValue, to: activity.toValue })
      .from(activity)
      .where(
        and(
          eq(activity.entityType, "issue"),
          eq(activity.entityId, issueId),
          eq(activity.field, "sprint"),
        ),
      )
      .orderBy(asc(activity.createdAt));

  const rejects = async (promise: Promise<unknown>, message: RegExp) => {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ServiceError);
    expect(error instanceof Error ? error.message : "").toMatch(message);
  };

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, "STK"));
    if (!project) throw new Error("seed made no project");
    projectId = project.id;
  });

  beforeEach(async () => {
    // Each test starts without sprints: issues back to the backlog, sprints removed.
    await db.execute(sql`UPDATE issues SET sprint_id = NULL`);
    await db.delete(sprints);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("creates, edits and deletes a planned sprint; delete returns its issues", async () => {
    const id = await createSprint("Sprint 1");
    await sprintService().updateSprint(actor, {
      sprintId: id,
      name: "Sprint One",
      goal: "Ship it",
      startDate: "2026-06-02",
      endDate: "2026-06-15",
    });
    const a = await createIssue("in sprint", 3);
    const done = await createIssue("done in sprint", 2);
    await addToSprint(a, id);
    await addToSprint(done, id);
    await setStatus(done, "Done");

    expect(await sprintService().deleteSprint(actor, id)).toEqual({ moved: 2 });
    expect(await sprintOf(a)).toBeNull();
    expect(await sprintOf(done)).toBeNull();
    expect(await issueSprintChanges(a)).toEqual([
      { from: null, to: id },
      { from: id, to: null },
    ]);
    const [deleted] = await sprintActivity(id, "sprint_deleted");
    expect(deleted?.meta).toMatchObject({ name: "Sprint One" });
    expect(await db.select().from(sprints).where(eq(sprints.id, id))).toEqual([]);
  });

  it("refuses to edit or delete a sprint that is not planned", async () => {
    const id = await createSprint("Sprint 1");
    await sprintService().startSprint(actor, id);
    await rejects(sprintService().deleteSprint(actor, id), /Only planned sprints.*active/);
    await rejects(
      sprintService().updateSprint(actor, {
        sprintId: id,
        name: "x",
        goal: null,
        startDate: "2026-06-01",
        endDate: "2026-06-02",
      }),
      /Only planned sprints/,
    );
  });

  it("starts a sprint with a snapshot of its open issues", async () => {
    const id = await createSprint("Sprint 1");
    const a = await createIssue("a", 3);
    const b = await createIssue("b", 5);
    const done = await createIssue("done", 8);
    for (const issue of [a, b, done]) await addToSprint(issue, id);
    await setStatus(done, "Done");

    const result = await sprintService().startSprint(actor, id);
    expect(result.committedPoints).toBe(8);
    expect([...result.issueIds].sort()).toEqual([a, b].sort());
    const [started] = await sprintActivity(id, "sprint_started");
    expect(started?.meta).toEqual({
      committedPoints: 8,
      issueIds: [a, b].sort(),
      memberIds: [a, b, done].sort(),
    });
    const [row] = await db.select({ state: sprints.state }).from(sprints).where(eq(sprints.id, id));
    expect(row?.state).toBe("active");
  });

  it("blocks starting a second sprint while one is active", async () => {
    const first = await createSprint("Sprint 1");
    const second = await createSprint("Sprint 2", "2026-06-15", "2026-06-28");
    await sprintService().startSprint(actor, first);
    await rejects(sprintService().startSprint(actor, second), /Another sprint is already active/);
    // Concurrent starts of two planned sprints: exactly one wins on the unique index.
    await sprintService().completeSprint(actor, { sprintId: first, carryTo: "backlog" });
    const third = await createSprint("Sprint 3", "2026-06-29", "2026-07-12");
    const results = await Promise.allSettled([
      sprintService().startSprint(actor, second),
      sprintService().startSprint(actor, third),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await rejects(sprintService().startSprint(actor, first), /Only planned sprints.*closed/);
  });

  it("completes into the next planned sprint, atomically logging each move", async () => {
    const id = await createSprint("Sprint 1");
    const next = await createSprint("Sprint 2", "2026-06-15", "2026-06-28");
    const later = await createSprint("Sprint 3", "2026-06-29", "2026-07-12");
    const done = await createIssue("done", 5);
    const wont = await createIssue("won't", 8);
    const open = await createIssue("open", 3);
    for (const issue of [done, wont, open]) await addToSprint(issue, id);
    await sprintService().startSprint(actor, id);
    await setStatus(done, "Done");
    await setStatus(wont, "Won't Do");

    const result = await sprintService().completeSprint(actor, { sprintId: id, carryTo: "next" });
    expect(result).toEqual({ carried: 1, targetSprintId: next, completedPoints: 5 });
    expect(await sprintOf(open)).toBe(next);
    expect(await sprintOf(done)).toBe(id);
    expect(await sprintOf(wont)).toBe(id);
    expect(await sprintOf(open)).not.toBe(later);
    expect((await issueSprintChanges(open)).at(-1)).toEqual({ from: id, to: next });
    const [completed] = await sprintActivity(id, "sprint_completed");
    expect(completed?.meta).toEqual({
      completedPoints: 5,
      carriedIssueIds: [open],
      carriedTo: next,
    });
    const [row] = await db
      .select({ state: sprints.state, closedAt: sprints.closedAt })
      .from(sprints)
      .where(eq(sprints.id, id));
    expect(row?.state).toBe("closed");
    expect(row?.closedAt).toBeInstanceOf(Date);
    await rejects(
      sprintService().completeSprint(actor, { sprintId: id, carryTo: "next" }),
      /Only active sprints/,
    );
  });

  it("creates the next sprint when none is planned", async () => {
    const id = await createSprint("Sprint 1", "2026-06-01", "2026-06-14");
    const open = await createIssue("open", 3);
    await addToSprint(open, id);
    await sprintService().startSprint(actor, id);

    const result = await sprintService().completeSprint(actor, { sprintId: id, carryTo: "next" });
    expect(result.carried).toBe(1);
    const [created] = await db
      .select()
      .from(sprints)
      .where(and(eq(sprints.projectId, projectId), eq(sprints.state, "planned")));
    expect(created).toMatchObject({
      id: result.targetSprintId,
      name: "Sprint 2",
      startDate: "2026-06-15",
      endDate: "2026-06-28",
    });
    expect(await sprintOf(open)).toBe(created?.id);
  });

  it("creates no next sprint when nothing is left open", async () => {
    const id = await createSprint("Sprint 1");
    const done = await createIssue("done", 3);
    await addToSprint(done, id);
    await sprintService().startSprint(actor, id);
    await setStatus(done, "Done");
    const result = await sprintService().completeSprint(actor, { sprintId: id, carryTo: "next" });
    expect(result).toEqual({ carried: 0, targetSprintId: null, completedPoints: 3 });
    expect(await db.select().from(sprints).where(eq(sprints.state, "planned"))).toEqual([]);
  });

  it("completes into the backlog", async () => {
    const id = await createSprint("Sprint 1");
    await createSprint("Sprint 2", "2026-06-15", "2026-06-28");
    const open = await createIssue("open", 3);
    await addToSprint(open, id);
    await sprintService().startSprint(actor, id);

    const result = await sprintService().completeSprint(actor, {
      sprintId: id,
      carryTo: "backlog",
    });
    expect(result).toEqual({ carried: 1, targetSprintId: null, completedPoints: 0 });
    expect(await sprintOf(open)).toBeNull();
    expect((await issueSprintChanges(open)).at(-1)).toEqual({ from: id, to: null });
  });

  it("sets the sprint field from the side panel and quick create, logging activity", async () => {
    const id = await createSprint("Sprint 1");
    const created = await issueService().createIssue(actor, {
      projectKey: "STK",
      title: "straight into the sprint",
      type: "task",
      priority: 2,
      sprintId: id,
    });
    expect(await sprintOf(created.id)).toBe(id);
    expect(await issueSprintChanges(created.id)).toEqual([{ from: null, to: id }]);

    const other = await createIssue("other");
    const change = await issueService().updateIssueField(actor, {
      issueId: other,
      field: "sprint",
      value: id,
    });
    expect(change).toEqual({ from: null, to: id, changed: true });
    expect(await issueSprintChanges(other)).toEqual([{ from: null, to: id }]);

    await sprintService().startSprint(actor, id);
    await sprintService().completeSprint(actor, { sprintId: id, carryTo: "backlog" });
    await rejects(
      issueService().updateIssueField(actor, { issueId: other, field: "sprint", value: id }),
      /closed/,
    );
    await rejects(addToSprint(other, id), /closed/);
  });

  it("re-ranks an issue dropped into a sprint section after another one", async () => {
    const id = await createSprint("Sprint 1");
    const first = await createIssue("first");
    const second = await createIssue("second");
    // New issues go to the top: second, first. Put first into the sprint, then second
    // into it right after first.
    await addToSprint(first, id);
    await planning().moveIssueToSprint(actor, {
      issueId: second,
      sprintId: id,
      afterIssueId: first,
    });
    const ordered = await db
      .select({ id: issues.id })
      .from(issues)
      .where(eq(issues.sprintId, id))
      .orderBy(asc(issues.rank));
    expect(ordered.map((row) => row.id)).toEqual([first, second]);
  });

  it("scopes the backlog page and the board (BLG-3, BRD-3)", async () => {
    const active = await createSprint("Sprint 1");
    const planned = await createSprint("Sprint 2", "2026-06-15", "2026-06-28");
    const inActive = await createIssue("in active");
    const doneInActive = await createIssue("done in active");
    const inPlanned = await createIssue("in planned");
    const backlog = await createIssue("in backlog");
    await addToSprint(inActive, active);
    await addToSprint(doneInActive, active);
    await addToSprint(inPlanned, planned);
    await setStatus(doneInActive, "Done");
    const list = (scope: "planning" | "board_sprint" | "board") =>
      planningQueries().listIssues(projectId, {
        scope,
        filters: EMPTY_FILTERS,
        currentUserId: actor,
      });

    // Without an active sprint the board keeps today's behaviour.
    const before = (await list("board_sprint")).map((issue) => issue.id);
    expect(before).toEqual(expect.arrayContaining([inActive, inPlanned, backlog]));

    await sprintService().startSprint(actor, active);
    const board = (await list("board_sprint")).map((issue) => issue.id);
    expect(board.sort()).toEqual([inActive, doneInActive].sort());
    expect((await list("board")).map((issue) => issue.id)).toContain(backlog);
    const planningIds = (await list("planning")).map((issue) => issue.id);
    expect(planningIds).toEqual(
      expect.arrayContaining([inActive, doneInActive, inPlanned, backlog]),
    );

    const summaries = await queries().listSprints(projectId);
    expect(summaries.map((sprint) => [sprint.name, sprint.state])).toEqual([
      ["Sprint 1", "active"],
      ["Sprint 2", "planned"],
    ]);
    expect(summaries[0]?.done.count).toBe(1);
    expect(await queries().getActiveSprint(projectId)).toEqual({ id: active, name: "Sprint 1" });
  });

  it("feeds the burndown and velocity from the activity log", async () => {
    const today = isoDateOf(new Date());
    const id = await createSprint("Sprint 1", today, addDays(today, 4));
    const a = await createIssue("a", 3);
    const b = await createIssue("b", 5);
    const wont = await createIssue("wont", 2);
    for (const issue of [a, b, wont]) await addToSprint(issue, id);
    await sprintService().startSprint(actor, id);
    const added = await createIssue("added", 1);
    await addToSprint(added, id);
    await setStatus(a, "Done");
    await setStatus(wont, "Won't Do");
    await sprintService().completeSprint(actor, { sprintId: id, carryTo: "backlog" });

    const { timelines, data } = await queries().burndownInputs(
      projectId,
      queries().activeAndRecentClosed(projectId),
    );
    const [timeline] = timelines;
    expect(timeline?.snapshotIssueIds?.slice().sort()).toEqual([a, b, wont].sort());
    expect(data.issues.map((issue) => issue.id).sort()).toEqual([a, b, wont, added].sort());
    if (!timeline) throw new Error("no timeline");
    const burndown = computeBurndown(timeline, data, new Date());
    expect(burndown?.committed).toBe(10);
    // Today's point is the state just before closing: b and the added issue still open, a
    // done, Won't Do dropped from the scope. Later days are empty (the sprint closed).
    expect(burndown?.points[1]).toMatchObject({ remaining: 6, completed: 3, scope: 9 });
    expect(burndown?.points.at(-1)?.remaining).toBeNull();
    expect(computeVelocity(timelines, data)).toEqual([
      { sprintId: id, name: "Sprint 1", completed: 3 },
    ]);
  });
});
