import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { cache } from "react";

import { env } from "@/env";

import { createTimedFetch } from "./query-log";
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

/**
 * One read batcher per server request (React `cache` is request-scoped), so the reads of
 * one page render go out as one `db.batch()` round trip, and requests never share a batch.
 * Outside a request scope each call gets a fresh batcher: correct, just unbatched.
 */
const requestRead = cache(() => createBatchedRead((queries) => db.batch(queries)));

/** `Read` on Neon HTTP: reads started in the same tick share one round trip. */
export const read: Read = (query) => requestRead()(query);
