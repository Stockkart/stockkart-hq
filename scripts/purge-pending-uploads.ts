/**
 * `pnpm purge:pending-uploads`: deletes ISS-9 uploads that were started but never confirmed
 * (status `pending`, older than 24 hours): the R2 object first, then the row. `startUpload`
 * already does this a few rows at a time; run this after an outage or to clear a backlog.
 *
 * Everything comes from the shell, never a file:
 *   DATABASE_URL='postgres://…?sslmode=require' R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… \
 *     R2_SECRET_ACCESS_KEY=… R2_BUCKET=… pnpm purge:pending-uploads
 *
 * Only `attachments/<uuid>/…` keys can be deleted (the storage module refuses anything else),
 * and only rows still `pending`; ready and soft-deleted attachments are never touched.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { databaseUrlUsesTls } from "../src/server/db/database-url";
import * as schema from "../src/server/db/schema";
import { createAttachmentService } from "../src/server/services/attachments";
import { createStorage, storageConfigFrom } from "../src/server/storage/storage";

const BATCH = 100;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (pass it in the shell, never in a file)");
  // Same rule as src/env.ts: encrypted connections only, except to a loopback Postgres.
  if (!databaseUrlUsesTls(url)) throw new Error("DATABASE_URL must set sslmode=require");
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  const config = storageConfigFrom({
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET,
  });
  if (!config) throw new Error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET");

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle({ client: pool, schema, casing: "snake_case" });
    const service = createAttachmentService(db, { storage: createStorage(config) });
    let total = 0;
    for (;;) {
      const purged = await service.purgeStalePending(BATCH);
      total += purged;
      if (purged < BATCH) break;
    }
    // Counts only; never keys, names or the connection string.
    process.stdout.write(`purge-pending-uploads: removed ${total}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("purge-pending-uploads failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
