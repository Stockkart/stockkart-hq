import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { rt } from "@/lib/rich-text";
import { docs, projects } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase } from "@/server/db/types";
import { createTestDatabase, describeDb, type TestDatabase } from "@/test/db";

import { createDocExportQueries } from "./doc-export";

/** DOC-12: the export query against Postgres (live doc, live project, live successor). */
describeDb("doc export queries (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let projectId: string;
  let queries: ReturnType<typeof createDocExportQueries>;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, "STK"));
    if (!project) throw new Error("seed created no STK project");
    projectId = project.id;
    queries = createDocExportQueries(db);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  let position = 0;
  async function insertDoc(values: Partial<typeof docs.$inferInsert>): Promise<string> {
    position += 1;
    const [row] = await db
      .insert(docs)
      .values({ projectId, title: "Doc", position: `a${position}`, ...values })
      .returning({ id: docs.id });
    if (!row) throw new Error("no doc");
    return row.id;
  }

  it("exports a page under its handbook path, preferring the override", async () => {
    const id = await insertDoc({
      title: "Architecture",
      type: "design",
      content: rt.doc(rt.paragraph("Hello")),
      sourcePath: "ARCHITECTURE.md",
    });
    expect(await queries.markdownFile("STK", id)).toEqual({
      path: "ARCHITECTURE.md",
      fileName: "ARCHITECTURE.md",
      markdown: "# Architecture\n\nHello\n",
    });
    await db.update(docs).set({ handbookPath: "design/ARCH.md" }).where(eq(docs.id, id));
    expect((await queries.markdownFile("STK", id))?.path).toBe("design/ARCH.md");
  });

  it("writes a superseded ADR's status with a link to its live successor", async () => {
    const successor = await insertDoc({
      type: "adr",
      title: "0061. New cache",
      adrNumber: 61,
      adrStatus: "accepted",
    });
    const id = await insertDoc({
      type: "adr",
      title: "0060. Old cache",
      adrNumber: 60,
      adrStatus: "superseded",
      adrSupersededBy: successor,
      content: rt.doc(rt.heading(2, "Status"), rt.paragraph("Accepted."), rt.heading(2, "Context")),
    });
    const file = await queries.markdownFile("STK", id);
    expect(file?.path).toBe("decisions/0060-old-cache.md");
    expect(file?.markdown).toBe(
      "# 0060. Old cache\n\n## Status\n\nSuperseded by [0061](0061-new-cache.md).\n\n## Context\n",
    );
    // A deleted successor reads as "Superseded" without a link.
    await db.update(docs).set({ deletedAt: new Date() }).where(eq(docs.id, successor));
    expect((await queries.markdownFile("STK", id))?.markdown).toContain("`Superseded`.");
  });

  it("returns null for a deleted doc, another project's key or an unknown id", async () => {
    const id = await insertDoc({ title: "Gone" });
    expect(await queries.markdownFile("OPS", id)).toBeNull();
    await db.update(docs).set({ deletedAt: new Date() }).where(eq(docs.id, id));
    expect(await queries.markdownFile("STK", id)).toBeNull();
    expect(await queries.markdownFile("STK", "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
