import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { env } from "@/env";

import * as schema from "./schema";

// Neon's HTTP driver: one HTTPS round trip per query, no pooled TCP connections,
// which suits Vercel serverless functions. `neon()` does not connect until the first query.
const sql = neon(env.DATABASE_URL);

export const db = drizzle({ client: sql, schema, casing: "snake_case" });

export type Database = typeof db;
