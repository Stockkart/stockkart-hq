import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { DB_TESTS_ENABLED, TEMPLATE_DB, testDatabaseUrl, urlForDatabase } from "./db-config";

/**
 * Vitest global setup: when HQ_DB_TESTS=1, (re)creates the template database and applies
 * every migration in drizzle/ to it, the same SQL production gets. A no-op otherwise.
 */
export default async function setup(): Promise<void | (() => Promise<void>)> {
  if (!DB_TESTS_ENABLED) return;

  const admin = new Pool({ connectionString: testDatabaseUrl().toString(), max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${TEMPLATE_DB}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${TEMPLATE_DB}"`);
  } finally {
    await admin.end();
  }

  // Closed before any test copies the template (CREATE DATABASE … TEMPLATE needs no
  // other connections to it).
  const pool = new Pool({ connectionString: urlForDatabase(TEMPLATE_DB), max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }

  return async () => {
    const cleanup = new Pool({ connectionString: testDatabaseUrl().toString(), max: 1 });
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS "${TEMPLATE_DB}" WITH (FORCE)`);
    } finally {
      await cleanup.end();
    }
  };
}
