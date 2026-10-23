import { randomBytes } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe } from "vitest";

import * as schema from "@/server/db/schema";
import { users } from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

import { DB_TESTS_ENABLED, TEMPLATE_DB, testDatabaseUrl, urlForDatabase } from "./db-config";

/**
 * Helpers for DB-backed tests (see db-config.ts for when they run). Without HQ_DB_TESTS=1,
 * `describeDb` suites are skipped, so `pnpm test` never needs a database.
 *
 * The global setup migrates a template database once; each test file gets its own copy
 * (`CREATE DATABASE … TEMPLATE`), so files run in parallel without sharing rows.
 */

export const describeDb = DB_TESTS_ENABLED ? describe : describe.skip;

export interface TestDatabase {
  db: AppDatabase;
  close(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `hq_test_${randomBytes(6).toString("hex")}`;
  const admin = new Pool({ connectionString: testDatabaseUrl().toString(), max: 1 });
  try {
    // Identifiers cannot be parameters; `name` is generated above from hex only.
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${TEMPLATE_DB}"`);
  } finally {
    await admin.end();
  }
  const pool = new Pool({ connectionString: urlForDatabase(name), max: 10 });
  return {
    db: drizzle({ client: pool, schema, casing: "snake_case" }),
    async close() {
      // `pool.end()` can resolve while a client's socket is still closing; the forced DROP
      // below then terminates it (57P01 admin_shutdown) and the pool re-emits that as an
      // unhandled 'error'. That is the expected end of this throwaway database: ignore it
      // (and only it) so it is not reported against whichever test file runs next.
      pool.on("error", (error) => {
        if ("code" in error && error.code === "57P01") return;
        throw error;
      });
      await pool.end();
      const cleanup = new Pool({ connectionString: testDatabaseUrl().toString(), max: 1 });
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

let userCounter = 0;

/** Inserts a fake HQ user (no real data). */
export async function createTestUser(db: AppDatabase, name = "Test User"): Promise<string> {
  userCounter += 1;
  const suffix = `${Date.now()}-${userCounter}`;
  const [row] = await db
    .insert(users)
    .values({
      stockkartUserId: `test-${suffix}`,
      name,
      email: `user-${suffix}@example.test`,
    })
    .returning({ id: users.id });
  if (!row) throw new Error("test user insert returned nothing");
  return row.id;
}
