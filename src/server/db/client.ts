import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { env } from "@/env";

import * as schema from "./schema";
import { type RunAtomic } from "./types";

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
