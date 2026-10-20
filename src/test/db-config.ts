import { LOOPBACK_HOSTS } from "../server/db/database-url";

/**
 * Configuration for the DB-backed tests, shared by the Vitest global setup and the helpers in
 * `db.ts`. They run only when HQ_DB_TESTS=1 and HQ_TEST_DATABASE_URL points at a throwaway,
 * loopback Postgres (CI: a `services: postgres` container; locally: see README).
 */

export const DB_TESTS_ENABLED = process.env.HQ_DB_TESTS === "1";
export const TEMPLATE_DB = "hq_test_template";

/** The admin URL, refused unless it is loopback, so tests can never reach a real database. */
export function testDatabaseUrl(): URL {
  const raw = process.env.HQ_TEST_DATABASE_URL;
  if (!raw) throw new Error("HQ_DB_TESTS=1 needs HQ_TEST_DATABASE_URL");
  const url = new URL(raw);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("HQ_TEST_DATABASE_URL must point at a loopback (throwaway) Postgres");
  }
  return url;
}

export function urlForDatabase(name: string): string {
  const url = testDatabaseUrl();
  url.pathname = `/${name}`;
  return url.toString();
}
