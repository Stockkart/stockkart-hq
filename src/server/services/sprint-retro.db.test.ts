import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { extractIssueRefs } from "@/lib/issues/keys";
import { extractPlainText } from "@/lib/rich-text";
import { RETROS_PAGE_TITLE } from "@/lib/sprints/retro";
import {
  activity,
  docs,
  entityLinks,
  projects,
  sprints,
  statuses,
  templates,
} from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { type CreatedIssue, createIssueService } from "./issues";
import { createPlanningService } from "./planning";
import { createProjectSettingsService } from "./project-settings";
import { createSettingsQueries } from "./settings-queries";
import { createSprintQueries } from "./sprint-queries";
import { RETRO_CREATED_ACTION } from "./sprint-retros";
import { createSprintService } from "./sprints";
import { projectIdByKey } from "./sql";

/** SPR-5 retro docs and the `auto_retro` setting, against real Postgres (HQ_DB_TESTS=1). */
describeDb("sprint retro (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let sprintNumber = 0;
  const runAtomic = () => transactionRunner(db);
  const issues = () => createIssueService(db, { runAtomic: runAtomic() });
  const sprintService = () => createSprintService(db, { runAtomic: runAtomic() });
  const settings = () => createProjectSettingsService(db, { runAtomic: runAtomic() });

  async function statusId(name: string) {
    const [row] = await db
      .select({ id: statuses.id })
      .from(statuses)
      .innerJoin(projects, eq(projects.id, statuses.projectId))
      .where(and(eq(projects.key, "STK"), eq(statuses.name, name)));
    if (!row) throw new Error(`no status ${name}`);
    return row.id;
  }

  /** An active sprint with a done (5 pts), a Won't Do and an open (3 pts) issue. */
  async function activeSprint() {
    sprintNumber += 1;
    const { id } = await sprintService().createSprint(actor, {
      projectKey: "STK",
      name: `Retro sprint ${sprintNumber}`,
      goal: "Ship the upload flow",
      startDate: "2026-06-01",
      endDate: "2026-06-14",
    });
    const made: CreatedIssue[] = [];
    for (const [title, points, status] of [
      ["Upload flow", 5, "Done"],
      ["Dropped idea", 2, "Won't Do"],
      ["Retry queue", 3, null],
    ] as const) {
      const issue = await issues().createIssue(actor, {
        projectKey: "STK",
        title,
        type: "task",
        priority: 2,
      });
      await issues().updateIssueField(actor, {
        issueId: issue.id,
        field: "storyPoints",
        value: points,
      });
      await createPlanningService(db).moveIssueToSprint(actor, { issueId: issue.id, sprintId: id });
      if (status) {
        await issues().updateIssueField(actor, {
          issueId: issue.id,
          field: "status",
          value: await statusId(status),
        });
      }
      made.push(issue);
    }
    await sprintService().startSprint(actor, id);
    const [done, wontDo, open] = made;
    if (!done || !wontDo || !open) throw new Error("issues missing");
    return { id, done, wontDo, open };
  }

  const retroDocs = async (sprintId: string) =>
    db
      .select({ id: docs.id, title: docs.title, content: docs.content, parentId: docs.parentId })
      .from(docs)
      .innerJoin(sprints, eq(sprints.retroDocId, docs.id))
      .where(and(eq(sprints.id, sprintId), isNull(docs.deletedAt)));

  const retrosPages = async () =>
    db
      .select({ id: docs.id })
      .from(docs)
      .where(and(eq(docs.title, RETROS_PAGE_TITLE), isNull(docs.parentId), isNull(docs.deletedAt)));

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Ada Actor");
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("toggles auto_retro in General settings", async () => {
    const queries = createSettingsQueries(db);
    expect((await queries.getSettings(projectIdByKey("STK")))?.project.autoRetro).toBe(false);
    await settings().setAutoRetro(actor, { projectKey: "STK", autoRetro: true });
    expect((await queries.getSettings(projectIdByKey("STK")))?.project.autoRetro).toBe(true);
    await settings().setAutoRetro(actor, { projectKey: "STK", autoRetro: false });
    await expect(
      settings().setAutoRetro(actor, { projectKey: "NOPE", autoRetro: true }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/not found/i) });
  });

  it("makes no retro on completion while auto_retro is off; Create retro makes one", async () => {
    const sprint = await activeSprint();
    const completed = await sprintService().completeSprint(actor, {
      sprintId: sprint.id,
      carryTo: "backlog",
    });
    expect(completed.retroDocId).toBeNull();
    expect(await retroDocs(sprint.id)).toHaveLength(0);
    // Reopened after the completion: a later retro still lists what the completion counted.
    await issues().updateIssueField(actor, {
      issueId: sprint.done.id,
      field: "status",
      value: await statusId("Todo"),
    });

    const retro = await sprintService().createRetro(actor, sprint.id);
    expect(retro.created).toBe(true);
    const [doc] = await retroDocs(sprint.id);
    expect(doc?.id).toBe(retro.docId);
    expect(extractPlainText(doc?.content ?? { type: "doc" })).toContain(
      `Completed 1 issue (5 points)`,
    );
  });

  it("creates the retro on completion with auto_retro on: content, parent, links", async () => {
    await settings().setAutoRetro(actor, { projectKey: "STK", autoRetro: true });
    const sprint = await activeSprint();
    const completed = await sprintService().completeSprint(actor, {
      sprintId: sprint.id,
      carryTo: "backlog",
    });
    expect(completed.retroDocId).not.toBeNull();

    const [doc] = await retroDocs(sprint.id);
    if (!doc?.content) throw new Error("no retro doc");
    expect(doc.id).toBe(completed.retroDocId);
    expect(doc.title).toBe(`Retro — Retro sprint ${sprintNumber}`);
    const [retrosPage] = await retrosPages();
    expect(doc.parentId).toBe(retrosPage?.id);

    const text = extractPlainText(doc.content);
    expect(text).toContain("Goal: Ship the upload flow");
    expect(text).toContain("Dates: Jun 1 – Jun 14");
    expect(text).toContain("Completed 1 issue (5 points); carried over 1 issue (3 points).");
    expect(text).toContain(`${sprint.done.key} Upload flow (5 pts)`);
    expect(text).toContain(`${sprint.open.key} Retry queue (3 pts)`);
    expect(text).not.toContain("Dropped idea");
    // The built-in template follows.
    const [template] = await db
      .select({ content: templates.content })
      .from(templates)
      .where(and(eq(templates.kind, "doc"), eq(templates.subtype, "retro")));
    expect(text).toContain(extractPlainText(template?.content ?? { type: "doc" }).split("\n")[0]);
    // The issue keys are mentions of the issues (shown as chips).
    expect(extractIssueRefs(text, ["STK"]).map((ref) => ref.number)).toEqual(
      expect.arrayContaining([sprint.done.number, sprint.open.number]),
    );
    const mentions = await db
      .select({ toId: entityLinks.toId })
      .from(entityLinks)
      .where(and(eq(entityLinks.fromType, "doc"), eq(entityLinks.fromId, doc.id)));
    expect(mentions.map((m) => m.toId).sort()).toEqual([sprint.done.id, sprint.open.id].sort());
    // And the sprint's history says so.
    const logged = await db
      .select({ meta: activity.meta })
      .from(activity)
      .where(
        and(
          eq(activity.entityType, "sprint"),
          eq(activity.entityId, sprint.id),
          eq(activity.action, RETRO_CREATED_ACTION),
        ),
      );
    expect(logged).toEqual([{ meta: { docId: doc.id } }]);
    // The sprint list links it.
    const listed = (await createSprintQueries(db).listSprints(projectIdByKey("STK"))).find(
      (s) => s.id === sprint.id,
    );
    expect(listed?.retroDocId).toBe(doc.id);
  });

  it("is idempotent: retries and concurrent creates never make a second retro", async () => {
    const sprint = await activeSprint();
    const completed = await sprintService().completeSprint(actor, {
      sprintId: sprint.id,
      carryTo: "backlog",
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => sprintService().createRetro(actor, sprint.id)),
    );
    expect(results.every((r) => r.docId === completed.retroDocId && !r.created)).toBe(true);
    const all = await db
      .select({ id: docs.id })
      .from(docs)
      .where(and(eq(docs.type, "retro"), eq(docs.title, `Retro — Retro sprint ${sprintNumber}`)));
    expect(all).toHaveLength(1);
    // Every retro shares one "Retros" page.
    expect(await retrosPages()).toHaveLength(1);
  });

  it("races two first creates into exactly one doc", async () => {
    await settings().setAutoRetro(actor, { projectKey: "STK", autoRetro: false });
    const sprint = await activeSprint();
    await sprintService().completeSprint(actor, { sprintId: sprint.id, carryTo: "backlog" });
    const results = await Promise.all([
      sprintService().createRetro(actor, sprint.id),
      sprintService().createRetro(actor, sprint.id),
      sprintService().createRetro(actor, sprint.id),
    ]);
    expect(new Set(results.map((r) => r.docId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await retroDocs(sprint.id)).toHaveLength(1);
  });

  it("treats a deleted retro as missing, and refuses a sprint that is not completed", async () => {
    const sprint = await activeSprint();
    await expect(sprintService().createRetro(actor, sprint.id)).rejects.toMatchObject({
      message: "A retro is made when the sprint is completed",
    });
    await sprintService().completeSprint(actor, { sprintId: sprint.id, carryTo: "backlog" });
    const first = await sprintService().createRetro(actor, sprint.id);
    await db.update(docs).set({ deletedAt: new Date() }).where(eq(docs.id, first.docId));
    const listed = (await createSprintQueries(db).listSprints(projectIdByKey("STK"))).find(
      (s) => s.id === sprint.id,
    );
    expect(listed?.retroDocId).toBeNull();
    const second = await sprintService().createRetro(actor, sprint.id);
    expect(second).toMatchObject({ created: true });
    expect(second.docId).not.toBe(first.docId);
  });
});
