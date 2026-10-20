import { eq } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { afterAll, beforeAll, expect, it } from "vitest";

import { type RichTextDoc } from "@/lib/rich-text";
import { HIGHLIGHT_END, HIGHLIGHT_START } from "@/lib/search/snippet";
import { docs, projects } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createCommentService } from "./comments";
import { createIssueService } from "./issues";
import { createSearchService } from "./search";

const paragraph = (text: string): RichTextDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** SRCH-1/2 against real Postgres full-text search. */
describeDb("search (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let actor: string;
  let projectId: string;
  const search = (q: string) => createSearchService(db).search(q);
  const issueService = () => createIssueService(db, { runAtomic: transactionRunner(db) });
  const commentService = () => createCommentService(db, { runAtomic: transactionRunner(db) });

  const create = (title: string, description?: string) =>
    issueService().createIssue(actor, {
      projectKey: "STK",
      title,
      type: "task",
      priority: 2,
      description: description ? paragraph(description) : null,
    });

  let docPosition: string | null = null;
  async function createDoc(
    title: string,
    text: string,
    extra: Partial<typeof docs.$inferInsert> = {},
  ) {
    docPosition = generateKeyBetween(docPosition, null);
    const [row] = await db
      .insert(docs)
      .values({ projectId, title, contentText: text, position: docPosition, ...extra })
      .returning({ id: docs.id });
    if (!row) throw new Error("doc insert failed");
    return row.id;
  }

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Searcher");
    const [project] = await db.select().from(projects).where(eq(projects.key, "STK"));
    if (!project) throw new Error("no project");
    projectId = project.id;
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("jumps straight to an existing issue key, case-insensitively", async () => {
    const issue = await create("Key jump target");
    const results = await search(issue.key.toLowerCase());
    expect(results.jump).toEqual({
      key: issue.key,
      title: "Key jump target",
      href: `/STK/issues/${issue.key}`,
    });
    expect((await search("STK-999999")).jump).toBeNull();
  });

  it("ranks title matches above body matches and groups by type", async () => {
    const inBody = await create("Unrelated title", "we should fix the outbox someday");
    const inTitle = await create("Outbox dispatch retries", "retry with backoff");
    const adr = await createDoc("Scheduled outbox dispatch", "Use a scheduler for the outbox.", {
      type: "adr",
      adrNumber: 8,
    });
    await commentService().createComment(actor, {
      issueId: inBody.id,
      body: paragraph("the outbox table grows"),
    });

    const results = await search("outbox");
    expect(results.issues.map((hit) => hit.id).slice(0, 2)).toEqual([inTitle.id, inBody.id]);
    expect(results.docs).toEqual([
      expect.objectContaining({
        id: adr,
        title: "ADR-0008 Scheduled outbox dispatch",
        href: `/STK/docs/${adr}`,
      }),
    ]);
    expect(results.comments).toEqual([
      expect.objectContaining({ kind: "comment", context: inBody.key }),
    ]);
    // Snippets are text plus ranges, highlighting the stemmed match.
    const snippet = results.issues.find((hit) => hit.id === inBody.id)?.snippet;
    expect(snippet?.text).toContain("outbox");
    const [range] = snippet?.highlights ?? [];
    expect(range && snippet?.text.slice(range[0], range[1]).toLowerCase()).toBe("outbox");
  });

  it("limits each group to five results", async () => {
    for (let i = 0; i < 7; i += 1) await create(`Lotsofmatches number ${i}`);
    expect((await search("lotsofmatches")).issues).toHaveLength(5);
  });

  it("excludes soft-deleted issues, docs and comments, and comments on deleted issues", async () => {
    const gone = await create("Vanishingterm issue");
    await issueService().deleteIssue(actor, gone.id);
    await createDoc("Vanishingterm doc", "text", { deletedAt: new Date() });
    const host = await create("Comment host");
    const { id: commentId } = await commentService().createComment(actor, {
      issueId: host.id,
      body: paragraph("vanishingterm in a comment"),
    });
    await commentService().deleteComment(actor, commentId);
    const orphanHost = await create("Orphan host");
    await commentService().createComment(actor, {
      issueId: orphanHost.id,
      body: paragraph("vanishingterm on a deleted issue"),
    });
    await issueService().deleteIssue(actor, orphanHost.id);

    const results = await search("vanishingterm");
    expect(results.issues).toEqual([]);
    expect(results.docs).toEqual([]);
    expect(results.comments).toEqual([]);
    expect((await search(gone.key)).jump).toBeNull();
  });

  it("returns snippets as text plus ranges; stored markers cannot fake a highlight", async () => {
    const issue = await create(
      "Sanitize check",
      `<script>alert(1)</script> zebrafish ${HIGHLIGHT_START}fake${HIGHLIGHT_END} <b>bold</b>`,
    );
    const hit = (await search("zebrafish")).issues.find((row) => row.id === issue.id);
    // Postgres' parser drops tags from headlines; what remains is plain text either way (the
    // palette renders it as text nodes, see command-palette.test.tsx).
    expect(hit?.snippet?.text).toContain("zebrafish");
    expect(hit?.snippet?.text).not.toContain(HIGHLIGHT_START);
    expect(hit?.snippet?.text).not.toContain(HIGHLIGHT_END);
    const highlighted = (hit?.snippet?.highlights ?? []).map(([start, end]) =>
      hit?.snippet?.text.slice(start, end),
    );
    expect(highlighted).toEqual(["zebrafish"]);
  });

  it("treats operators and odd input safely", async () => {
    await expect(search('"unclosed -not or')).resolves.toBeDefined();
    await expect(search("the")).resolves.toMatchObject({ issues: [] });
    await expect(search("")).resolves.toMatchObject({ jump: null, issues: [] });
  });
});
