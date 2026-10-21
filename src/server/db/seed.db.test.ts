import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { createTestDatabase, describeDb, type TestDatabase } from "@/test/db";

import { components, projects, statuses, templates } from "./schema";
import { seed } from "./seed";

describeDb("seed (Postgres)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("creates the STK project, components, workflow and templates, and is re-runnable", async () => {
    const { db } = testDb;
    const first = await seed(db);
    expect(first).toMatchObject({
      projectCreated: true,
      componentsCreated: 5,
      statusesCreated: 7,
      templatesUpserted: 22,
    });

    const second = await seed(db);
    expect(second).toMatchObject({
      projectId: first.projectId,
      projectCreated: false,
      componentsCreated: 0,
      statusesCreated: 0,
    });

    expect(await db.select({ key: projects.key, name: projects.name }).from(projects)).toEqual([
      { key: "STK", name: "Stockkart" },
    ]);
    const componentRows = await db
      .select({ name: components.name, repo: components.githubRepo })
      .from(components)
      .orderBy(asc(components.name));
    expect(componentRows).toEqual([
      { name: "hq", repo: "Stockkart/stockkart-hq" },
      { name: "infra", repo: null },
      { name: "inventory-api", repo: "Stockkart/inventory-api" },
      { name: "inventory-platform", repo: "Stockkart/inventory-platform" },
      { name: "loadtest", repo: null },
    ]);
    const statusRows = await db
      .select({ name: statuses.name, category: statuses.category, def: statuses.isDefaultFor })
      .from(statuses)
      .where(eq(statuses.projectId, first.projectId))
      .orderBy(asc(statuses.position));
    expect(statusRows).toEqual([
      { name: "Triage", category: "todo", def: "bug" },
      { name: "Backlog", category: "todo", def: "other" },
      { name: "Todo", category: "todo", def: null },
      { name: "In Progress", category: "in_progress", def: null },
      { name: "In Review", category: "in_progress", def: null },
      { name: "Done", category: "done", def: null },
      { name: "Won't Do", category: "done", def: null },
    ]);
    const templateRows = await db
      .select({ subtype: templates.subtype })
      .from(templates)
      .where(eq(templates.kind, "issue"))
      .orderBy(asc(templates.subtype));
    expect(templateRows.map((row) => row.subtype)).toEqual(["bug", "spike", "story", "tech_debt"]);

    // DOC-5 / §6.1: all 13 doc templates, once each even after the second run.
    const docTemplates = await db
      .select({ subtype: templates.subtype, content: templates.content })
      .from(templates)
      .where(eq(templates.kind, "doc"));
    expect(docTemplates).toHaveLength(13);
    const adr = docTemplates.find((row) => row.subtype === "adr");
    const headings = (adr?.content.content ?? [])
      .filter((node) => node.type === "heading")
      .map((node) => node.content?.[0]?.text);
    // Mirrors engineering-handbook/decisions/0000-template.md.
    expect(headings).toEqual(["Status", "Context", "Decision", "Consequences", "Evidence (paths)"]);

    // DGM-3 / §6.3: the five diagram templates, once each after the second run, refreshed
    // in place (same ids).
    const diagramTemplates = await db
      .select({ id: templates.id, subtype: templates.subtype })
      .from(templates)
      .where(eq(templates.kind, "diagram"))
      .orderBy(asc(templates.subtype));
    expect(diagramTemplates.map((row) => row.subtype)).toEqual([
      "flow:auth",
      "flow:outbox",
      "flow:request",
      "whiteboard:c4_container",
      "whiteboard:system_context",
    ]);
    expect(second.templatesUpserted).toBe(22);
    const third = await seed(db);
    expect(third.templatesUpserted).toBe(22);
    const again = await db
      .select({ id: templates.id, subtype: templates.subtype })
      .from(templates)
      .where(eq(templates.kind, "diagram"))
      .orderBy(asc(templates.subtype));
    expect(again).toEqual(diagramTemplates);
  });
});
