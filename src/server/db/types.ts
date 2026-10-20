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
