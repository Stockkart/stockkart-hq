import type { SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type * as schema from "./schema";

/**
 * Driver-agnostic Drizzle handle. Production uses Neon's HTTP driver (`client.ts`); the seed
 * script and the DB-backed tests use node-postgres. Services take this type so the same code
 * runs on both.
 *
 * Neon HTTP has no interactive transactions, so a service write that must be atomic is a
 * single SQL statement (data-modifying CTEs), which Postgres always runs atomically on any
 * driver. Results of raw statements are parsed with Zod (`rowsOf`).
 */
export type AppDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Runs raw statements, in order, in ONE transaction and returns their raw results. Use it
 * when a later statement must see the database after an earlier one took its row locks:
 * each statement in a READ COMMITTED transaction gets a fresh snapshot, whereas all parts of
 * a single statement share the snapshot taken before it waited for any lock.
 *
 * Neon HTTP: `db.batch()` (one non-interactive transaction). node-postgres: `db.transaction()`.
 */
export type RunAtomic = (statements: readonly [SQL, ...SQL[]]) => Promise<unknown[]>;

/** The node-postgres (and any interactive-transaction driver) implementation. */
export function transactionRunner(db: AppDatabase): RunAtomic {
  return (statements) =>
    db.transaction(async (tx) => {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await tx.execute(statement));
      return results;
    });
}
