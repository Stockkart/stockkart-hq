import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";

import { pgErrorInfo } from "@/server/services/errors";
import { rowsOf } from "@/server/services/sql";
import { createTestDatabase, describeDb, type TestDatabase } from "@/test/db";

import { seed } from "./seed";
import { type AppDatabase } from "./types";

/** Constraint name (or SQLSTATE) of the Postgres error a write failed with. */
async function violation(write: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await write;
  } catch (error) {
    return pgErrorInfo(error)?.constraint ?? pgErrorInfo(error)?.code;
  }
  return undefined;
}

/** Migration 0007: the costs (IMR) tables, their CHECKs and the new enum values. */
describeDb("costs foundation schema (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let projectId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    const result = await db.execute(sql`SELECT id::text FROM projects WHERE key = 'STK'`);
    projectId = rowsOf(result, z.object({ id: z.string() }))[0]?.id ?? "";
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("applies every migration, 0000 through 0007, on an empty database", async () => {
    const result = await db.execute(
      sql`SELECT count(*)::int AS n, max(created_at)::text AS last
        FROM drizzle.__drizzle_migrations`,
    );
    expect(rowsOf(result, z.object({ n: z.number(), last: z.string() }))).toEqual([
      { n: 8, last: "1792776584110" },
    ]);
  });

  it("adds the enum values (usable by app queries once 0007 is committed)", async () => {
    const result = await db.execute(sql`
      SELECT 'cost_item'::entity_type::text AS entity, 'cost_reminder'::notification_type::text AS type
    `);
    expect(rowsOf(result, z.object({ entity: z.string(), type: z.string() }))).toEqual([
      { entity: "cost_item", type: "cost_reminder" },
    ]);
  });

  it.each([
    ["EUR", "cost_items_currency"],
    ["inr", "cost_items_currency"],
  ])("refuses item currency %s", async (currency, constraint) => {
    await expect(
      violation(
        db.execute(sql`
          INSERT INTO cost_items (project_id, name, category, billing_cycle, currency, position)
          VALUES (${projectId}::uuid, 'X', 'hosting', 'monthly', ${currency}, 'a0')
        `),
      ),
    ).resolves.toBe(constraint);
  });

  it("refuses settings outside the rules", async () => {
    const insert = (columns: string, values: string) =>
      db.execute(
        sql.raw(
          `INSERT INTO cost_settings (project_id, ${columns}) VALUES ('${projectId}', ${values})`,
        ),
      );
    await expect(violation(insert("reminder_day", "0"))).resolves.toBe(
      "cost_settings_reminder_day",
    );
    await expect(violation(insert("reminder_day", "29"))).resolves.toBe(
      "cost_settings_reminder_day",
    );
    await expect(violation(insert("base_currency", "'EUR'"))).resolves.toBe(
      "cost_settings_base_currency",
    );
    await expect(violation(insert("default_usd_to_inr", "0"))).resolves.toBe(
      "cost_settings_usd_to_inr",
    );
    await expect(violation(insert("monthly_budget_minor", "-1"))).resolves.toBe(
      "cost_settings_budget",
    );
    await insert("reminder_day", "28");
    await expect(violation(insert("reminder_day", "3"))).resolves.toBe(
      "cost_settings_project_unique",
    );
    const result = await db.execute(sql`
      SELECT base_currency, reminder_day, reminder_user_ids::text FROM cost_settings
    `);
    expect(rowsOf(result, z.unknown())).toEqual([
      { base_currency: "INR", reminder_day: 28, reminder_user_ids: "{}" },
    ]);
  });
});
