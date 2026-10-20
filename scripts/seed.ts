/**
 * `pnpm db:seed`: idempotent bootstrap data (STK project, components, workflow, built-in
 * templates). See src/server/db/seed.ts.
 *
 * DATABASE_URL is read from the shell only, like `pnpm db:migrate`, so the URL never lands in
 * a file:  DATABASE_URL='postgres://…' pnpm db:seed
 *
 * Uses node-postgres (TCP) rather than Neon's HTTP driver so it also works against a local
 * Postgres. Neon accepts plain Postgres connections with sslmode=require.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { databaseUrlUsesTls } from "../src/server/db/database-url";
import * as schema from "../src/server/db/schema";
import { seed } from "../src/server/db/seed";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (pass it in the shell, never in a file)");
  // Same rule as src/env.ts: encrypted connections only, except to a loopback Postgres.
  if (!databaseUrlUsesTls(url)) throw new Error("DATABASE_URL must set sslmode=require");

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle({ client: pool, schema, casing: "snake_case" });
    const summary = await seed(db);
    // Ids and counts only; never the connection string.
    process.stdout.write(`seed: ${JSON.stringify(summary)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
