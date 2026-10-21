import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createComponentInput,
  setComponentRepoInput,
  updateProjectInput,
} from "@/lib/settings/schemas";
import {
  activity,
  components,
  issueLabels,
  issues,
  labels,
  projects,
  statuses,
} from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createIssueService } from "./issues";
import { createPlanningService } from "./planning";
import { createProjectSettingsService } from "./project-settings";
import { createSettingsQueries } from "./settings-queries";
import { projectIdByKey } from "./sql";
import { createSprintQueries } from "./sprint-queries";
import { createSprintService } from "./sprints";

/** PRJ-2/PRJ-3 against real Postgres (HQ_DB_TESTS=1): the workflow rules live in SQL. */
describeDb("project settings (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let other: string;
  let projectId: string;
  const settings = () => createProjectSettingsService(db, { runAtomic: transactionRunner(db) });
  const issueService = () => createIssueService(db, { runAtomic: transactionRunner(db) });

  async function statusId(name: string): Promise<string> {
    const [row] = await db
      .select({ id: statuses.id })
      .from(statuses)
      .where(and(eq(statuses.projectId, projectId), eq(statuses.name, name)));
    if (!row) throw new Error(`no status ${name}`);
    return row.id;
  }

  const statusList = () =>
    db
      .select({
        id: statuses.id,
        name: statuses.name,
        category: statuses.category,
        position: statuses.position,
        isDefaultFor: statuses.isDefaultFor,
      })
      .from(statuses)
      .where(eq(statuses.projectId, projectId))
      .orderBy(statuses.position);

  const create = (title: string, extra: { assigneeId?: string | null } = {}) =>
    issueService().createIssue(actor, {
      projectKey: "STK",
      title,
      type: "task",
      priority: 2,
      ...extra,
    });

  async function issueRow(id: string) {
    const [row] = await db.select().from(issues).where(eq(issues.id, id));
    if (!row) throw new Error("issue missing");
    return row;
  }

  const activityOf = (issueId: string) =>
    db
      .select()
      .from(activity)
      .where(and(eq(activity.entityType, "issue"), eq(activity.entityId, issueId)));

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    projectId = (await seed(db)).projectId;
    actor = await createTestUser(db, "Ada Actor");
    other = await createTestUser(db, "Bo Other");
  });

  afterAll(async () => {
    await testDb?.close();
  });

  describe("general", () => {
    it("saves the general fields, and quick create uses the default assignee", async () => {
      await settings().updateProject(
        actor,
        updateProjectInput.parse({
          projectKey: "STK",
          name: "  Stockkart   HQ ",
          description: "  ",
          leadId: actor,
          defaultAssigneeId: other,
          sprintLengthDays: 10,
        }),
      );
      const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
      expect(project).toMatchObject({
        name: "Stockkart HQ",
        description: null,
        leadId: actor,
        defaultAssigneeId: other,
        sprintLengthDays: 10,
      });

      const defaulted = await create("No assignee given");
      expect((await issueRow(defaulted.id)).assigneeId).toBe(other);
      const explicit = await create("Explicitly unassigned", { assigneeId: null });
      expect((await issueRow(explicit.id)).assigneeId).toBeNull();
      const mine = await create("Mine", { assigneeId: actor });
      expect((await issueRow(mine.id)).assigneeId).toBe(actor);

      await settings().updateProject(actor, {
        projectKey: "STK",
        name: "Stockkart",
        description: null,
        leadId: null,
        defaultAssigneeId: null,
        sprintLengthDays: 14,
      });
      expect((await issueRow((await create("Back to none")).id)).assigneeId).toBeNull();
    });

    it("rejects an unknown user and an out-of-range sprint length", async () => {
      await expect(
        settings().updateProject(actor, {
          projectKey: "STK",
          name: "Stockkart",
          description: null,
          leadId: crypto.randomUUID(),
          defaultAssigneeId: null,
          sprintLengthDays: 14,
        }),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(
        updateProjectInput.safeParse({
          projectKey: "STK",
          name: "x",
          leadId: null,
          defaultAssigneeId: null,
          sprintLengthDays: 0,
        }).success,
      ).toBe(false);
    });
  });

  describe("workflow", () => {
    it("adds a status at the end; names are unique in any case", async () => {
      const { id } = await settings().createStatus(actor, {
        projectKey: "STK",
        name: "QA",
        category: "in_progress",
      });
      const list = await statusList();
      expect(list.at(-1)).toMatchObject({ id, name: "QA", category: "in_progress" });
      await expect(
        settings().createStatus(actor, { projectKey: "STK", name: "qa", category: "todo" }),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it("renames, but keeps Won't Do (velocity knows it by name)", async () => {
      const qa = await statusId("QA");
      await settings().renameStatus(actor, { statusId: qa, name: "Testing" });
      expect((await statusList()).some((s) => s.name === "Testing")).toBe(true);
      await expect(
        settings().renameStatus(actor, { statusId: qa, name: "done" }),
      ).rejects.toMatchObject({ code: "conflict" });
      await expect(
        settings().renameStatus(actor, { statusId: await statusId("Won't Do"), name: "Nope" }),
      ).rejects.toMatchObject({ code: "invalid" });
      await expect(
        settings().renameStatus(actor, { statusId: qa, name: "Won't Do" }),
      ).rejects.toMatchObject({ code: "invalid" });
    });

    it("reorders to first, after another, and renumbers 0…n-1", async () => {
      const testing = await statusId("Testing");
      await settings().moveStatus(actor, { statusId: testing, afterStatusId: null });
      let list = await statusList();
      expect(list[0]?.id).toBe(testing);
      expect(list.map((s) => s.position)).toEqual(list.map((_, i) => i));

      const inProgress = await statusId("In Progress");
      await settings().moveStatus(actor, { statusId: testing, afterStatusId: inProgress });
      list = await statusList();
      const names = list.map((s) => s.name);
      expect(names.indexOf("Testing")).toBe(names.indexOf("In Progress") + 1);
      expect(list.map((s) => s.position)).toEqual(list.map((_, i) => i));

      await expect(
        settings().moveStatus(actor, { statusId: testing, afterStatusId: crypto.randomUUID() }),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("keeps exactly one default per kind, never a done one", async () => {
      const todo = await statusId("Todo");
      const triage = await statusId("Triage");
      const backlog = await statusId("Backlog");
      await settings().setStatusDefault(actor, { statusId: todo, kind: "bug" });
      let list = await statusList();
      expect(list.filter((s) => s.isDefaultFor === "bug").map((s) => s.id)).toEqual([todo]);
      expect(list.find((s) => s.id === triage)?.isDefaultFor).toBeNull();

      // Backlog is the default for everything else: it cannot also become the bug default.
      await expect(
        settings().setStatusDefault(actor, { statusId: backlog, kind: "bug" }),
      ).rejects.toMatchObject({ code: "invalid" });
      await expect(
        settings().setStatusDefault(actor, { statusId: await statusId("Done"), kind: "other" }),
      ).rejects.toMatchObject({ code: "invalid" });
      list = await statusList();
      expect(list.filter((s) => s.isDefaultFor === "bug").map((s) => s.id)).toEqual([todo]);
      expect(list.filter((s) => s.isDefaultFor === "other").map((s) => s.id)).toEqual([backlog]);

      // New bugs now start in Todo.
      const bug = await issueService().createIssue(actor, {
        projectKey: "STK",
        title: "A bug",
        type: "bug",
        priority: 2,
      });
      expect((await issueRow(bug.id)).statusId).toBe(todo);
      await settings().setStatusDefault(actor, { statusId: triage, kind: "bug" });
    });

    it("changes a category; issues follow (resolved_at) and every category keeps one", async () => {
      const testing = await statusId("Testing");
      const issue = await create("In testing");
      await issueService().updateIssueField(actor, {
        issueId: issue.id,
        field: "status",
        value: testing,
      });
      await settings().setStatusCategory(actor, { statusId: testing, category: "done" });
      expect((await issueRow(issue.id)).resolvedAt).not.toBeNull();
      await settings().setStatusCategory(actor, { statusId: testing, category: "in_progress" });
      expect((await issueRow(issue.id)).resolvedAt).toBeNull();

      // A default status cannot become done.
      await expect(
        settings().setStatusCategory(actor, {
          statusId: await statusId("Backlog"),
          category: "done",
        }),
      ).rejects.toMatchObject({ code: "invalid" });
    });

    it("deletes an unused status; refuses a default and the last of a category", async () => {
      const { id } = await settings().createStatus(actor, {
        projectKey: "STK",
        name: "Parked",
        category: "todo",
      });
      expect(await settings().deleteStatus(actor, { statusId: id })).toEqual({ moved: 0 });
      expect((await statusList()).some((s) => s.id === id)).toBe(false);

      await expect(
        settings().deleteStatus(actor, { statusId: await statusId("Triage") }),
      ).rejects.toMatchObject({ code: "invalid" });

      // Make "done" a one-status category, then try to remove its last status.
      const wontDo = await statusId("Won't Do");
      const done = await statusId("Done");
      await settings().setStatusCategory(actor, { statusId: wontDo, category: "in_progress" });
      await expect(settings().deleteStatus(actor, { statusId: done })).rejects.toThrow(
        /at least one status/,
      );
      await expect(
        settings().setStatusCategory(actor, { statusId: done, category: "todo" }),
      ).rejects.toThrow(/at least one status/);
      await settings().setStatusCategory(actor, { statusId: wontDo, category: "done" });
    });

    it("moves the issues of a used status (trashed ones too) atomically, with activity", async () => {
      const { id: review2 } = await settings().createStatus(actor, {
        projectKey: "STK",
        name: "Review 2",
        category: "in_progress",
      });
      const live = await create("Live in review 2");
      const trashed = await create("Trashed in review 2");
      for (const issue of [live, trashed]) {
        await issueService().updateIssueField(actor, {
          issueId: issue.id,
          field: "status",
          value: review2,
        });
      }
      await issueService().deleteIssue(actor, trashed.id);

      // Used: needs a target; a target of another project (or itself) is refused.
      await expect(settings().deleteStatus(actor, { statusId: review2 })).rejects.toThrow(
        /2 issues use this status/,
      );
      await expect(
        settings().deleteStatus(actor, {
          statusId: review2,
          moveToStatusId: crypto.randomUUID(),
        }),
      ).rejects.toThrow(/not found/);
      expect((await issueRow(live.id)).statusId).toBe(review2);

      const done = await statusId("Done");
      expect(
        await settings().deleteStatus(actor, { statusId: review2, moveToStatusId: done }),
      ).toEqual({ moved: 2 });
      for (const issue of [live, trashed]) {
        const row = await issueRow(issue.id);
        expect(row.statusId).toBe(done);
        expect(row.resolvedAt).not.toBeNull();
        const moves = (await activityOf(issue.id)).filter(
          (entry) => entry.field === "status" && entry.toValue === done,
        );
        expect(moves).toHaveLength(1);
        expect(moves[0]).toMatchObject({ fromValue: review2, actorId: actor });
        expect(moves[0]?.meta).toMatchObject({ reason: "status_deleted", fromName: "Review 2" });
      }
      expect((await statusList()).some((s) => s.id === review2)).toBe(false);
    });

    it("keeps burndowns counting a deleted status by its recorded category", async () => {
      const sprintService = createSprintService(db, { runAtomic: transactionRunner(db) });
      const { id: sprintId } = await sprintService.createSprint(actor, {
        projectKey: "STK",
        name: "Sprint S",
        goal: null,
        startDate: "2026-06-01",
        endDate: "2026-06-14",
      });
      const { id: shipped } = await settings().createStatus(actor, {
        projectKey: "STK",
        name: "Shipped",
        category: "done",
      });
      const issue = await create("Shipped then moved");
      await createPlanningService(db).moveIssueToSprint(actor, { issueId: issue.id, sprintId });
      await sprintService.startSprint(actor, sprintId);
      await issueService().updateIssueField(actor, {
        issueId: issue.id,
        field: "status",
        value: shipped,
      });
      await settings().deleteStatus(actor, {
        statusId: shipped,
        moveToStatusId: await statusId("Done"),
      });
      const queries = createSprintQueries(db);
      const { data } = await queries.burndownInputs(
        projectIdByKey("STK"),
        queries.oneSprint(projectIdByKey("STK"), sprintId),
      );
      expect(data.statusKinds.get(shipped)).toBe("done");
    });
  });

  describe("labels", () => {
    it("creates, renames, colours and deletes (detaching it from issues)", async () => {
      const { id } = await settings().createLabel(actor, {
        projectKey: "STK",
        name: "perf",
        color: "#ef4444",
      });
      await expect(
        settings().createLabel(actor, { projectKey: "STK", name: "perf", color: null }),
      ).rejects.toMatchObject({ code: "conflict" });
      await settings().renameLabel(actor, { labelId: id, name: "performance" });
      await settings().setLabelColor(actor, { labelId: id, color: "#3b82f6" });
      const [label] = await db.select().from(labels).where(eq(labels.id, id));
      expect(label).toMatchObject({ name: "performance", color: "#3b82f6" });

      const a = await create("Slow A");
      const b = await create("Slow B");
      await issueService().addLabel(actor, { issueId: a.id, name: "performance" });
      await issueService().addLabel(actor, { issueId: b.id, name: "performance" });
      const { id: taken } = await settings().createLabel(actor, {
        projectKey: "STK",
        name: "taken",
        color: null,
      });
      await expect(
        settings().renameLabel(actor, { labelId: taken, name: "performance" }),
      ).rejects.toMatchObject({ code: "conflict" });

      expect(await settings().deleteLabel(actor, id)).toEqual({ detached: 2 });
      expect(await db.select().from(issueLabels).where(eq(issueLabels.labelId, id))).toEqual([]);
      expect(await db.select().from(labels).where(eq(labels.id, id))).toEqual([]);
      for (const issue of [a, b]) {
        const removed = (await activityOf(issue.id)).filter((e) => e.action === "label_removed");
        expect(removed).toHaveLength(1);
        expect(removed[0]).toMatchObject({ fromValue: id, field: "labels" });
        expect(removed[0]?.meta).toMatchObject({ name: "performance", reason: "label_deleted" });
      }
      await expect(settings().deleteLabel(actor, id)).rejects.toMatchObject({
        code: "not_found",
      });
    });
  });

  describe("components", () => {
    it("validates Owner/repo", () => {
      const ok = (githubRepo: string) =>
        setComponentRepoInput.safeParse({ componentId: crypto.randomUUID(), githubRepo }).success;
      expect(ok("Stockkart/inventory-api")).toBe(true);
      expect(ok("a-b/c.d_e")).toBe(true);
      expect(ok("")).toBe(true);
      expect(ok("inventory-api")).toBe(false);
      expect(ok("-bad/repo")).toBe(false);
      expect(ok("Owner/..")).toBe(false);
      expect(ok("Owner/repo/extra")).toBe(false);
      expect(ok("https://github.com/Stockkart/x")).toBe(false);
    });

    it("creates, renames, sets the repo and deletes (unsetting it on issues)", async () => {
      const { id } = await settings().createComponent(
        actor,
        createComponentInput.parse({ projectKey: "STK", name: "mobile", githubRepo: "" }),
      );
      await expect(
        settings().createComponent(actor, {
          projectKey: "STK",
          name: "Mobile",
          githubRepo: null,
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      await settings().renameComponent(actor, { componentId: id, name: "mobile-app" });
      await expect(
        settings().renameComponent(actor, { componentId: id, name: "INFRA" }),
      ).rejects.toMatchObject({ code: "conflict" });
      await settings().setComponentRepo(actor, {
        componentId: id,
        githubRepo: "Stockkart/mobile-app",
      });
      const [row] = await db.select().from(components).where(eq(components.id, id));
      expect(row).toMatchObject({ name: "mobile-app", githubRepo: "Stockkart/mobile-app" });

      const issue = await create("On mobile");
      await issueService().updateIssueField(actor, {
        issueId: issue.id,
        field: "component",
        value: id,
      });
      expect(await settings().deleteComponent(actor, id)).toEqual({ unset: 1 });
      expect((await issueRow(issue.id)).componentId).toBeNull();
      const unset = (await activityOf(issue.id)).filter(
        (e) => e.field === "component" && e.toValue === null,
      );
      expect(unset).toHaveLength(1);
      expect(unset[0]).toMatchObject({ fromValue: id });
    });
  });

  it("loads the settings page data with usage counts", async () => {
    const page = await createSettingsQueries(db).getSettings(projectIdByKey("STK"));
    expect(page?.project.key).toBe("STK");
    const done = page?.statuses.find((s) => s.name === "Done");
    expect(done?.issueCount).toBeGreaterThan(0);
    expect(done?.trashedCount).toBe(1);
    expect(page?.statuses.map((s) => s.position)).toEqual(page?.statuses.map((_, i) => i));
    expect(await createSettingsQueries(db).getSettings(projectIdByKey("NOPE"))).toBeNull();
  });
});
