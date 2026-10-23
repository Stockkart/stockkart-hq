import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";

import { pgErrorInfo } from "@/server/services/errors";
import { rowsOf } from "@/server/services/sql";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { docs, handbookPublicationDocs, handbookPublications, projects } from "./schema";
import { seed } from "./seed";
import { type AppDatabase } from "./types";

/** Constraint name (or SQLSTATE) of the Postgres error a write failed with. */
async function violation(write: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await write;
  } catch (error) {
    return pgErrorInfo(error)?.constraint ?? pgErrorInfo(error)?.code;
  }
  return undefined;
}

const SHA = "0123456789abcdef0123456789abcdef01234567";

/** Migration 0006: the columns and tables the handbook sync slice builds on (Postgres). */
describeDb("handbook foundation schema (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let alice: string;
  let projectId: string;
  let position = 0;

  async function newDoc(values: Partial<typeof docs.$inferInsert> = {}): Promise<string> {
    position += 1;
    const [doc] = await db
      .insert(docs)
      .values({ projectId, title: "Doc", position: `a${position}`, ...values })
      .returning({ id: docs.id });
    if (!doc) throw new Error("no doc");
    return doc.id;
  }

  async function newPublication(branch: string): Promise<string> {
    const [row] = await db
      .insert(handbookPublications)
      .values({ projectId, branch, createdBy: alice })
      .returning({ id: handbookPublications.id });
    if (!row) throw new Error("no publication");
    return row.id;
  }

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    alice = await createTestUser(db, "Alice");
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.key, "STK"));
    if (!project) throw new Error("seed created no STK project");
    projectId = project.id;
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("applies every migration, 0000 through 0006, on an empty database", async () => {
    // Later migrations (0007 costs …) apply too; their own tests pin the total.
    const result = await db.execute(
      sql`SELECT count(*)::int AS n,
        bool_or(created_at = 1792760105217) AS has_0006
        FROM drizzle.__drizzle_migrations`,
    );
    const [row] = rowsOf(result, z.object({ n: z.number(), has_0006: z.boolean() }));
    expect(row?.has_0006).toBe(true);
    expect(row?.n).toBeGreaterThanOrEqual(7);
  });

  it("adds nullable sync columns to docs", async () => {
    const id = await newDoc();
    const [row] = await db.select().from(docs).where(eq(docs.id, id));
    expect(row).toMatchObject({
      handbookPath: null,
      handbookBlobSha: null,
      handbookSyncedVersion: null,
      handbookSyncedAt: null,
      handbookRemoteSha: null,
      handbookRemoteSeenAt: null,
    });
  });

  it.each([
    ["../x.md", "docs_handbook_path_format"],
    ["/abs.md", "docs_handbook_path_format"],
    [".github/x.md", "docs_handbook_path_format"],
    ["notes.txt", "docs_handbook_path_format"],
    ["a..b.md", "docs_handbook_path_format"],
  ])("rejects handbook_path %j", async (handbookPath, constraint) => {
    expect(await violation(newDoc({ handbookPath }))).toBe(constraint);
  });

  it("checks sha formats and keeps the sync columns consistent", async () => {
    const now = new Date();
    expect(
      await violation(
        newDoc({ handbookBlobSha: "ABC", handbookSyncedVersion: 1, handbookSyncedAt: now }),
      ),
    ).toBe("docs_handbook_blob_sha_format");
    expect(await violation(newDoc({ handbookBlobSha: SHA }))).toBe("docs_handbook_synced_together");
    expect(
      await violation(
        newDoc({ handbookBlobSha: SHA, handbookSyncedVersion: 2, handbookSyncedAt: now }),
      ),
    ).toBe("docs_handbook_synced_version_valid");
    expect(await violation(newDoc({ handbookRemoteSha: SHA }))).toBe(
      "docs_handbook_remote_sha_seen",
    );
    expect(
      await violation(newDoc({ handbookRemoteSha: SHA.toUpperCase(), handbookRemoteSeenAt: now })),
    ).toBe("docs_handbook_remote_sha_format");
    // A file seen absent on the default branch: no sha, a time.
    await newDoc({ handbookRemoteSeenAt: now });
    await newDoc({
      handbookPath: "decisions/0099-ok.md",
      handbookBlobSha: SHA,
      handbookSyncedVersion: 1,
      handbookSyncedAt: now,
      handbookRemoteSha: SHA,
      handbookRemoteSeenAt: now,
    });
  });

  it("allows one live doc per repo file (override or source path)", async () => {
    await newDoc({ sourcePath: "RUNBOOK.md" });
    expect(await violation(newDoc({ handbookPath: "RUNBOOK.md" }))).toBe(
      "docs_project_handbook_file_unique",
    );
    // Case-insensitive, like a macOS or Windows checkout.
    expect(await violation(newDoc({ handbookPath: "Runbook.md" }))).toBe(
      "docs_project_handbook_file_unique",
    );
    const other = await newDoc({ handbookPath: "OTHER.md" });
    await db.update(docs).set({ deletedAt: new Date() }).where(eq(docs.id, other));
    // A deleted doc frees its file.
    await newDoc({ handbookPath: "OTHER.md" });
  });

  it("checks publication branches, PR fields, merge time and error codes", async () => {
    const insert = (values: Partial<typeof handbookPublications.$inferInsert>) =>
      db.insert(handbookPublications).values({ projectId, branch: "hq/x", ...values });
    expect(await violation(insert({ branch: "main" }))).toBe("handbook_publications_branch_format");
    expect(await violation(insert({ branch: "hq/a..b" }))).toBe(
      "handbook_publications_branch_format",
    );
    expect(await violation(insert({ branch: "hq/x.lock" }))).toBe(
      "handbook_publications_branch_format",
    );
    expect(await violation(insert({ branch: "hq/a/b" }))).toBe(
      "handbook_publications_branch_format",
    );
    expect(await violation(insert({ branch: "hq/p1", prNumber: 3 }))).toBe(
      "handbook_publications_pr_together",
    );
    expect(
      await violation(insert({ branch: "hq/p2", prNumber: 3, prUrl: "https://evil.test/pull/3" })),
    ).toBe("handbook_publications_pr_url_format");
    expect(await violation(insert({ branch: "hq/p3", state: "merged" }))).toBe(
      "handbook_publications_merged_at_state",
    );
    expect(await violation(insert({ branch: "hq/p4", state: "closed" }))).toBe(
      "handbook_publications_merged_has_pr",
    );
    expect(await violation(insert({ branch: "hq/p5", errorCode: "conflict" }))).toBe(
      "handbook_publications_error_code",
    );
    expect(
      await violation(insert({ branch: "hq/p6", state: "failed", errorCode: "Bad Code!" })),
    ).toBe("handbook_publications_error_code");
    await insert({ branch: "hq/p7", state: "failed", errorCode: "github_403" });
    await insert({
      branch: "hq/p8",
      state: "merged",
      mergedAt: new Date(),
      prNumber: 8,
      prUrl: "https://github.com/Stockkart/engineering-handbook/pull/8",
    });
    expect(await violation(insert({ branch: "hq/p8" }))).toBe(
      "handbook_publications_project_branch_unique",
    );
  });

  it("allows at most one OPEN publication per doc, kept in sync by the FK cascade", async () => {
    const docId = await newDoc();
    const first = await newPublication("hq/one");
    const second = await newPublication("hq/two");
    const row = (publicationId: string) => ({
      publicationId,
      docId,
      path: "PAGE.md",
      docVersion: 1,
    });
    await db.insert(handbookPublicationDocs).values(row(first));
    expect(await violation(db.insert(handbookPublicationDocs).values(row(second)))).toBe(
      "handbook_publication_docs_one_open_per_doc",
    );
    // A row cannot claim a state its publication does not have.
    expect(
      await violation(db.insert(handbookPublicationDocs).values({ ...row(second), open: false })),
    ).toBe("handbook_publication_docs_publication_open_fk");

    // Closing the first publication flips `open` on its rows in the same statement…
    await db
      .update(handbookPublications)
      .set({
        state: "closed",
        prNumber: 11,
        prUrl: "https://github.com/Stockkart/engineering-handbook/pull/11",
      })
      .where(eq(handbookPublications.id, first));
    const [closed] = await db
      .select({ open: handbookPublicationDocs.open })
      .from(handbookPublicationDocs)
      .where(
        and(
          eq(handbookPublicationDocs.publicationId, first),
          eq(handbookPublicationDocs.docId, docId),
        ),
      );
    expect(closed).toEqual({ open: false });
    // …so the doc can join another open one, and reopening the first now fails.
    await db.insert(handbookPublicationDocs).values(row(second));
    expect(
      await violation(
        db
          .update(handbookPublications)
          .set({ state: "open" })
          .where(eq(handbookPublications.id, first)),
      ),
    ).toBe("handbook_publication_docs_one_open_per_doc");
    // Deleting a publication or a doc removes its rows.
    await db.delete(handbookPublications).where(eq(handbookPublications.id, second));
    const left = await db
      .select({ id: handbookPublicationDocs.publicationId })
      .from(handbookPublicationDocs)
      .where(eq(handbookPublicationDocs.docId, docId));
    expect(left).toEqual([{ id: first }]);
  });

  it("checks publication doc paths and shas", async () => {
    const docId = await newDoc();
    const publicationId = await newPublication("hq/paths");
    const insert = (values: Partial<typeof handbookPublicationDocs.$inferInsert>) =>
      db
        .insert(handbookPublicationDocs)
        .values({ publicationId, docId, path: "A.md", docVersion: 1, ...values });
    expect(await violation(insert({ path: "../A.md" }))).toBe(
      "handbook_publication_docs_path_format",
    );
    expect(await violation(insert({ docVersion: 0 }))).toBe(
      "handbook_publication_docs_version_positive",
    );
    expect(await violation(insert({ blobSha: "xyz" }))).toBe(
      "handbook_publication_docs_blob_sha_format",
    );
    await insert({ blobSha: SHA });
    // One file per path in a publication.
    const otherDoc = await newDoc();
    expect(
      await violation(
        db
          .insert(handbookPublicationDocs)
          .values({ publicationId, docId: otherDoc, path: "a.md", docVersion: 1 }),
      ),
    ).toBe("handbook_publication_docs_publication_path_unique");
  });
});
