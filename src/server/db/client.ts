import { AsyncLocalStorage } from "node:async_hooks";

import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { cache } from "react";

import { env } from "@/env";

import { createTimedFetch, withRequestStats } from "./query-log";
import { createBatchedRead, type Read } from "./read-batch";
import * as schema from "./schema";
import { type RunAtomic } from "./types";

// HQ_LOG_QUERIES=1 (development only): log each Neon round trip with counts and timings.
if (env.HQ_LOG_QUERIES) neonConfig.fetchFunction = createTimedFetch(fetch);

// Neon's HTTP driver: one HTTPS round trip per query, no pooled TCP connections,
// which suits Vercel serverless functions. `neon()` does not connect until the first query.
const sql = neon(env.DATABASE_URL);

export const db = drizzle({ client: sql, schema, casing: "snake_case" });

export type Database = typeof db;

/** `RunAtomic` on Neon HTTP: `db.batch()` sends the statements as one transaction. */
export const runAtomic: RunAtomic = async ([first, ...rest]) => {
  const queries: [ReturnType<typeof db.execute>, ...ReturnType<typeof db.execute>[]] = [
    db.execute(first),
    ...rest.map((statement) => db.execute(statement)),
  ];
  return db.batch(queries);
};

const newBatcher = () => createBatchedRead((queries) => db.batch(queries));

/**
 * One read batcher per server render (React `cache` is request-scoped there), so the reads
 * of a layout and its page go out as one `db.batch()` round trip, and requests never share
 * a batch. React `cache` is only guaranteed to be request-scoped inside a render, so server
 * actions run inside `batchReads`, which gives each call its own batcher explicitly. Anywhere else each
 * call gets a fresh one: correct, just unbatched.
 */
const renderRead = cache(newBatcher);
const actionRead = new AsyncLocalStorage<Read>();

/** `Read` on Neon HTTP: reads started in the same tick share one round trip. */
export const read: Read = (query) => (actionRead.getStore() ?? renderRead())(query);

/** Runs a server action's work with its own read batcher (and query-log totals). */
export function batchReads<T>(fn: () => Promise<T>): Promise<T> {
  return withRequestStats(() => actionRead.run(newBatcher(), fn));
}
