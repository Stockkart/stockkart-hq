import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";

import { pgErrorInfo } from "@/server/services/errors";
import { rowsOf } from "@/server/services/sql";
import { createTestDatabase, describeDb, type TestDatabase } from "@/test/db";
import { testDatabaseUrl, urlForDatabase } from "@/test/db-config";

import { seed } from "./seed";
import { type AppDatabase } from "./types";

async function violation(write: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await write;
  } catch (error) {
    return pgErrorInfo(error)?.constraint ?? pgErrorInfo(error)?.code;
  }
  return undefined;
}

const V0008_WHEN = 1792821829716;

/** Migration 0008: the BRD-6 / VW-4 view-default columns on `projects` (Postgres). */
describeDb("view defaults schema, migration 0008 (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    // Seeding twice is a no-op the second time (the seed is re-runnable).
    await seed(db);
    await seed(db);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("applies every migration, 0000 through 0008, on an empty database", async () => {
    const result = await db.execute(
      sql`SELECT count(*)::int AS n, max(created_at)::text AS last
        FROM drizzle.__drizzle_migrations`,
    );
    expect(rowsOf(result, z.object({ n: z.number(), last: z.string() }))).toEqual([
      { n: 9, last: String(V0008_WHEN) },
    ]);
  });

  it("adds nullable type arrays and empty hidden-status arrays by default", async () => {
    const columns = await db.execute(sql`
      SELECT column_name::text AS name, udt_name::text AS type, is_nullable::text AS nullable,
        column_default::text AS "default"
      FROM information_schema.columns
      WHERE table_name = 'projects' AND column_name IN ('board_issue_types',
        'board_hidden_status_ids', 'list_issue_types', 'list_hidden_status_ids')
      ORDER BY column_name
    `);
    expect(
      rowsOf(
        columns,
        z.object({
          name: z.string(),
          type: z.string(),
          nullable: z.string(),
          default: z.string().nullable(),
        }),
      ),
    ).toEqual([
      { name: "board_hidden_status_ids", type: "_uuid", nullable: "NO", default: "'{}'::uuid[]" },
      { name: "board_issue_types", type: "_issue_type", nullable: "YES", default: null },
      { name: "list_hidden_status_ids", type: "_uuid", nullable: "NO", default: "'{}'::uuid[]" },
      { name: "list_issue_types", type: "_issue_type", nullable: "YES", default: null },
    ]);
    const seeded = await db.execute(sql`
      SELECT board_issue_types IS NULL AS board_all, cardinality(board_hidden_status_ids) AS bh,
        list_issue_types IS NULL AS list_all, cardinality(list_hidden_status_ids) AS lh
      FROM projects WHERE key = 'STK'
    `);
    expect(
      rowsOf(
        seeded,
        z.object({ board_all: z.boolean(), bh: z.number(), list_all: z.boolean(), lh: z.number() }),
      ),
    ).toEqual([{ board_all: true, bh: 0, list_all: true, lh: 0 }]);
  });

  it("refuses empty or oversized arrays (CHECK)", async () => {
    const set = (assignment: string) =>
      db.execute(sql.raw(`UPDATE projects SET ${assignment} WHERE key = 'STK'`));
    await expect(violation(set("board_issue_types = '{}'"))).resolves.toBe(
      "projects_board_issue_types_size",
    );
    await expect(violation(set("list_issue_types = '{}'"))).resolves.toBe(
      "projects_list_issue_types_size",
    );
    const many = `ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 21))`;
    await expect(violation(set(`board_hidden_status_ids = ${many}`))).resolves.toBe(
      "projects_board_hidden_status_ids_size",
    );
    await expect(violation(set(`list_hidden_status_ids = ${many}`))).resolves.toBe(
      "projects_list_hidden_status_ids_size",
    );
    await expect(
      violation(set("board_issue_types = '{bug,task}', list_issue_types = NULL")),
    ).resolves.toBeUndefined();
  });
});

/**
 * Deploy order: 0008 may be applied while the code built for 0007 still runs. That code's
 * statements name the projects columns it knows (drizzle lists them), so they must work on
 * a 0008 database, and rows they insert must get the defaults.
 */
describeDb("0007-era statements on a database migrated to 0008 (Postgres)", () => {
  const name = `hq_test_${randomBytes(6).toString("hex")}`;
  let pool: Pool;

  beforeAll(async () => {
    const admin = new Pool({ connectionString: testDatabaseUrl().toString(), max: 1 });
    try {
      // Identifiers cannot be parameters; `name` is generated above from hex only.
      await admin.query(`CREATE DATABASE "${name}"`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: urlForDatabase(name), max: 1 });
  });

  afterAll(async () => {
    await pool?.end();
    const cleanup = new Pool({ connectionString: testDatabaseUrl().toString(), max: 1 });
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await cleanup.end();
    }
  });

  /** Applies the migrations with index `from`…`to` (the journal order), one transaction. */
  async function apply(from: number, to: number) {
    const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" }).slice(from, to + 1);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const migration of migrations) {
        for (const statement of migration.sql) await client.query(statement);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** What the 0007 code runs against `projects` (columns as its schema lists them). */
  async function legacyStatements(key: string) {
    const db = drizzle({ client: pool });
    await db.execute(sql`
      INSERT INTO projects (key, name, description, issue_counter, incident_counter,
        sprint_length_days, auto_retro)
      VALUES (${key}, 'Legacy', NULL, 0, 0, 14, false)
    `);
    await db.execute(sql`
      INSERT INTO statuses (project_id, name, category, position)
      SELECT id, 'Todo', 'todo', 0 FROM projects WHERE key = ${key}
    `);
    await db.execute(sql`UPDATE projects SET name = 'Legacy 2', auto_retro = true
      WHERE key = ${key} AND archived_at IS NULL`);
    const read = await db.execute(sql`
      SELECT id, key, name, sprint_length_days FROM projects
      WHERE key = ${key} AND archived_at IS NULL LIMIT 1
    `);
    return rowsOf(read, z.object({ key: z.string(), name: z.string() }));
  }

  it("keeps the 0007 code's project reads and writes working after 0008", async () => {
    const all = readMigrationFiles({ migrationsFolder: "./drizzle" });
    const index0008 = all.findIndex((migration) => migration.folderMillis === V0008_WHEN);
    expect(index0008).toBe(8);
    await apply(0, index0008 - 1);
    expect(await legacyStatements("OLD")).toEqual([{ key: "OLD", name: "Legacy 2" }]);
    await apply(index0008, index0008);
    expect(await legacyStatements("NEW")).toEqual([{ key: "NEW", name: "Legacy 2" }]);
    const defaults = await pool.query<{ key: string; types: null; hidden: string }>(`
      SELECT key, board_issue_types AS types, list_hidden_status_ids::text AS hidden
      FROM projects ORDER BY key
    `);
    expect(defaults.rows).toEqual([
      { key: "NEW", types: null, hidden: "{}" },
      { key: "OLD", types: null, hidden: "{}" },
    ]);
  });
});
