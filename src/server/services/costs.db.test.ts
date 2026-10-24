import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { STOCKKART_DEFAULT_COSTS } from "@/lib/costs/defaults";
import { localDate, periodToMonth } from "@/lib/costs/month";
import {
  createCostItemInput,
  setCostEntryInput,
  updateCostItemInput,
  updateCostSettingsInput,
} from "@/lib/costs/schemas";
import { notificationText } from "@/lib/notifications/format";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createCostQueries, createCostReminderJob, createCostService } from "./costs";
import { ServiceError } from "./errors";
import { createNotificationQueries } from "./notification-queries";
import { createServiceRegistry } from "./service-registry";
import { projectIdByKey, rowsOf } from "./sql";

/** COST-1…8 against Postgres: constraints, defaults, entries, FX, settings, activity. */

const rawItem = (fields: Record<string, unknown> = {}) => ({
  projectKey: "STK",
  name: "Vercel",
  vendor: "Vercel",
  category: "hosting",
  billingCycle: "monthly",
  currency: "USD",
  expectedAmountMinor: null,
  renewsOn: null,
  serviceId: null,
  notes: "",
  ...fields,
});
const item = (fields: Record<string, unknown> = {}) => createCostItemInput.parse(rawItem(fields));

const entry = (itemId: string, fields: Record<string, unknown> = {}) =>
  setCostEntryInput.parse({
    itemId,
    month: "2030-02",
    amountMinor: 2000,
    currency: "USD",
    fxRate: "83.25",
    kind: "actual",
    notes: "",
    ...fields,
  });

const settings = (fields: Record<string, unknown> = {}) =>
  updateCostSettingsInput.parse({
    projectKey: "STK",
    baseCurrency: "INR",
    monthlyBudgetMinor: null,
    reminderDay: 1,
    reminderUserIds: [],
    defaultUsdToInr: null,
    ...fields,
  });

async function expectServiceError(promise: Promise<unknown>, code: ServiceError["code"]) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ServiceError);
  expect((error as ServiceError).code).toBe(code);
}

describeDb("costs (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let ada: string;
  let costs: ReturnType<typeof createCostService>;
  let queries: ReturnType<typeof createCostQueries>;
  const projectId = projectIdByKey("STK");

  async function activityOf(itemId: string) {
    const result = await db.execute(sql`
      SELECT action, field, from_value, to_value FROM activity
      WHERE entity_type = 'cost_item' AND entity_id = ${itemId}::uuid ORDER BY created_at, id
    `);
    return rowsOf(
      result,
      z.object({
        action: z.string(),
        field: z.string().nullable(),
        from_value: z.string().nullable(),
        to_value: z.string().nullable(),
      }),
    );
  }

  async function wipe() {
    await db.execute(sql`DELETE FROM cost_entries`);
    await db.execute(sql`DELETE FROM cost_items`);
    await db.execute(sql`DELETE FROM cost_settings`);
  }

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    ada = await createTestUser(db, "Ada Admin");
    costs = createCostService(db, { runAtomic: transactionRunner(db) });
    queries = createCostQueries(db);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  beforeEach(wipe);

  describe("items", () => {
    it("keeps names unique per project, case-insensitively, among live items", async () => {
      const first = await costs.createItem(ada, item({ name: "Vercel" }));
      await expectServiceError(costs.createItem(ada, item({ name: "vercel" })), "conflict");
      await costs.deleteItem(ada, first.id);
      // A deleted item frees its name.
      await expect(costs.createItem(ada, item({ name: "VERCEL" }))).resolves.toHaveProperty("id");
      const listed = await queries.items(projectId);
      expect(listed.map((row) => row.name)).toEqual(["VERCEL"]);
    });

    it("logs created / updated / archived / deleted without money in the activity", async () => {
      const { id } = await costs.createItem(ada, item({ expectedAmountMinor: 2000 }));
      await costs.updateItem(
        ada,
        updateCostItemInput.parse({
          ...rawItem({ expectedAmountMinor: 2500, vendor: "Vercel Inc." }),
          itemId: id,
        }),
      );
      await costs.setActive(ada, id, false);
      await costs.setActive(ada, id, true);
      await costs.deleteItem(ada, id);
      const rows = await activityOf(id);
      const steps = rows.map((row) => `${row.action}:${row.field ?? ""}`);
      // One update writes one row per changed field in the same statement, so those rows
      // share created_at and their order (by random uuid) is not meaningful: compare as a set.
      expect([steps[0], steps.slice(1, 3).sort(), ...steps.slice(3)]).toEqual([
        "created:",
        ["updated:expectedAmount", "updated:vendor"],
        "archived:active",
        "reactivated:active",
        "deleted:",
      ]);
      expect(steps).toHaveLength(6);
      const expected = rows.find((row) => row.field === "expectedAmount");
      expect(expected?.to_value).toBeNull();
      expect(expected?.from_value).toBeNull();
    });

    it("links only the project's live services", async () => {
      const otherProject = await db.execute(sql`
        INSERT INTO projects (key, name) VALUES ('OTH', 'Other') RETURNING id::text
      `);
      const [other] = rowsOf(otherProject, z.object({ id: z.string() }));
      const serviceRows = await db.execute(sql`
        INSERT INTO services (project_id, name, slug, position)
        VALUES (${other?.id}::uuid, 'Elsewhere', 'elsewhere', 'a0') RETURNING id::text
      `);
      const [service] = rowsOf(serviceRows, z.object({ id: z.string() }));
      await expectServiceError(
        costs.createItem(ada, item({ serviceId: service?.id ?? null })),
        "not_found",
      );
    });

    it("reorders with fractional keys", async () => {
      const a = await costs.createItem(ada, item({ name: "A" }));
      await costs.createItem(ada, item({ name: "B" }));
      await costs.createItem(ada, item({ name: "C" }));
      await costs.moveItem(ada, { itemId: a.id, index: 2 });
      expect((await queries.items(projectId)).map((row) => row.name)).toEqual(["B", "C", "A"]);
    });
  });

  describe("Add Stockkart defaults (COST-6)", () => {
    it("adds every default once, without amounts, linked to existing services by slug", async () => {
      await createServiceRegistry(db, { runAtomic: transactionRunner(db) }).addDefaults(ada, "STK");
      const first = await costs.addDefaults(ada, { projectKey: "STK" });
      expect(first.created).toEqual(STOCKKART_DEFAULT_COSTS.map((cost) => cost.name));
      const again = await costs.addDefaults(ada, { projectKey: "STK" });
      expect(again.created).toEqual([]);
      const listed = await queries.items(projectId);
      expect(listed).toHaveLength(STOCKKART_DEFAULT_COSTS.length);
      expect(listed.every((row) => row.expectedAmountMinor === null)).toBe(true);
      const byName = new Map(listed.map((row) => [row.name, row]));
      expect(byName.get("DigitalOcean App Platform")?.service?.slug).toBe("inventory-api");
      expect(byName.get("Vercel")?.service?.slug).toBe("stockkart-hq");
      expect(byName.get("MongoDB Atlas")?.service?.slug).toBe("mongodb-atlas");
      expect(byName.get("Neon Postgres")?.service?.slug).toBe("neon-postgres");
      expect(byName.get("Cloudflare R2")?.service).toBeNull();
      expect(byName.get("Domain")).toMatchObject({ billingCycle: "yearly", currency: "INR" });
    });

    it("adds only the missing ones (by name, case-insensitively)", async () => {
      await costs.createItem(ada, item({ name: "github" }));
      const result = await costs.addDefaults(ada, { projectKey: "STK" });
      expect(result.created).not.toContain("GitHub");
      expect(result.created).toHaveLength(STOCKKART_DEFAULT_COSTS.length - 1);
    });
  });

  describe("entries (COST-2/3)", () => {
    it("converts at the entry's rate (half-up) and upserts one row per item and month", async () => {
      const { id } = await costs.createItem(ada, item());
      const saved = await costs.setEntry(
        ada,
        entry(id, { amountMinor: 1999, fxRate: "83.333333" }),
      );
      expect(saved).toMatchObject({ baseAmountMinor: 166583, fxRate: "83.333333" });
      await costs.setEntry(ada, entry(id, { amountMinor: 2000, kind: "estimate" }));
      const rows = await queries.entriesBetween(projectId, "2030-01", "2030-03");
      expect(rows).toEqual([
        expect.objectContaining({
          month: "2030-02",
          amountMinor: 2000,
          currency: "USD",
          fxRate: "83.250000",
          baseAmountMinor: 166500,
          kind: "estimate",
          enteredByName: "Ada Admin",
        }),
      ]);
      const activity = await activityOf(id);
      expect(activity.filter((row) => row.action === "entry_set")).toEqual([
        { action: "entry_set", field: "entry:2030-02", from_value: null, to_value: "actual" },
        { action: "entry_set", field: "entry:2030-02", from_value: "actual", to_value: "estimate" },
      ]);
    });

    it("requires a rate for another currency and stores no-charge months as 0 in the base", async () => {
      const { id } = await costs.createItem(ada, item());
      await expectServiceError(costs.setEntry(ada, entry(id, { fxRate: null })), "invalid");
      await costs.setEntry(ada, entry(id, { kind: "no_charge", amountMinor: 0, fxRate: null }));
      const [row] = await queries.entriesBetween(projectId, "2030-02", "2030-02");
      expect(row).toMatchObject({
        amountMinor: 0,
        currency: "INR",
        fxRate: null,
        kind: "no_charge",
      });
      const inr = await costs.createItem(ada, item({ name: "Domain", currency: "INR" }));
      // The base currency needs no rate; one sent anyway is dropped.
      await costs.setEntry(ada, entry(inr.id, { currency: "INR", amountMinor: 99900 }));
      const rows = await queries.entriesBetween(projectId, "2030-02", "2030-02");
      expect(rows.find((r) => r.itemId === inr.id)).toMatchObject({
        fxRate: null,
        baseAmountMinor: 99900,
      });
    });

    it("keeps a saved entry's own currency after the item's currency changes", async () => {
      const { id } = await costs.createItem(ada, item());
      await costs.setEntry(ada, entry(id, { amountMinor: 10000 }));
      await costs.updateItem(
        ada,
        updateCostItemInput.parse({ ...rawItem({ currency: "INR" }), itemId: id }),
      );
      // The Month tab re-sends the entry in its own currency (USD) with its rate.
      await costs.setEntry(ada, entry(id, { amountMinor: 10000, notes: "edited" }));
      const [row] = await queries.entriesBetween(projectId, "2030-02", "2030-02");
      expect(row).toMatchObject({ currency: "USD", baseAmountMinor: 832500, notes: "edited" });
    });

    it("clears an entry", async () => {
      const { id } = await costs.createItem(ada, item());
      await costs.setEntry(ada, entry(id));
      await costs.clearEntry(ada, { itemId: id, month: "2030-02" });
      expect(await queries.entriesBetween(projectId, "2030-02", "2030-02")).toEqual([]);
      await expectServiceError(
        costs.clearEntry(ada, { itemId: id, month: "2030-02" }),
        "not_found",
      );
    });

    it("enforces the table rules (first of month, one per month, no-charge, amounts)", async () => {
      const { id } = await costs.createItem(ada, item());
      const insert = (
        period: string,
        amount: number,
        base: number,
        kind: string,
        rate: string | null,
      ) =>
        db.execute(sql`
          INSERT INTO cost_entries (item_id, period, amount_minor, currency, fx_rate_to_base,
            base_amount_minor, kind)
          VALUES (${id}::uuid, ${period}::date, ${amount}, 'USD', ${rate}::numeric, ${base},
            ${kind}::cost_entry_kind)
        `);
      await expect(insert("2030-02-02", 1, 1, "actual", null)).rejects.toThrow();
      await expect(insert("2030-02-01", 5, 5, "no_charge", null)).rejects.toThrow();
      await expect(insert("2030-02-01", -1, -1, "actual", null)).rejects.toThrow();
      await expect(insert("2030-02-01", 1_000_000_000_000, 1, "actual", "1")).rejects.toThrow();
      await expect(insert("2030-02-01", 100, 99, "actual", null)).rejects.toThrow();
      await insert("2030-02-01", 100, 8325, "actual", "83.25");
      await expect(insert("2030-02-01", 100, 8325, "actual", "83.25")).rejects.toThrow();
    });

    it("copies last month as estimates once (COST-5)", async () => {
      const hosting = await costs.createItem(ada, item({ name: "Hosting" }));
      const free = await costs.createItem(ada, item({ name: "Free", billingCycle: "usage" }));
      const domain = await costs.createItem(
        ada,
        item({ name: "Domain", currency: "INR", billingCycle: "yearly" }),
      );
      await costs.setEntry(ada, entry(hosting.id, { month: "2030-01" }));
      await costs.setEntry(
        ada,
        entry(free.id, { month: "2030-01", kind: "no_charge", amountMinor: 0 }),
      );
      await costs.setEntry(
        ada,
        entry(domain.id, { month: "2030-01", currency: "INR", amountMinor: 99900 }),
      );
      const first = await costs.copyLastMonth(ada, { projectKey: "STK", month: "2030-02" });
      expect(first.copied).toBe(2);
      const again = await costs.copyLastMonth(ada, { projectKey: "STK", month: "2030-02" });
      expect(again.copied).toBe(0);
      const february = await queries.entriesBetween(projectId, "2030-02", "2030-02");
      expect(february).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            itemId: hosting.id,
            kind: "estimate",
            baseAmountMinor: 166500,
          }),
          expect.objectContaining({ itemId: free.id, kind: "no_charge", amountMinor: 0 }),
        ]),
      );
      expect(february.some((row) => row.itemId === domain.id)).toBe(false);
    });
  });

  describe("settings (COST-8)", () => {
    it("reads the defaults before the first save", async () => {
      await expect(queries.settings(projectId)).resolves.toMatchObject({
        baseCurrency: "INR",
        reminderDay: 1,
        reminderUserIds: [],
        saved: false,
        hasEntries: false,
      });
    });

    it("keeps only real users and refuses a base currency change once entries exist", async () => {
      const bob = await createTestUser(db, "Bob Builder");
      await costs.updateSettings(
        ada,
        settings({
          baseCurrency: "USD",
          reminderDay: 28,
          reminderUserIds: [bob, "00000000-0000-4000-8000-000000000000"],
          monthlyBudgetMinor: 5000000,
          defaultUsdToInr: "0.012",
        }),
      );
      await expect(queries.settings(projectId)).resolves.toMatchObject({
        baseCurrency: "USD",
        reminderDay: 28,
        reminderUserIds: [bob],
        monthlyBudgetMinor: 5000000,
        defaultUsdToInr: "0.012000",
        saved: true,
      });
      await costs.updateSettings(ada, settings());
      const { id } = await costs.createItem(ada, item());
      await costs.setEntry(ada, entry(id));
      await expectServiceError(
        costs.updateSettings(ada, settings({ baseCurrency: "USD" })),
        "conflict",
      );
      // Other fields still save.
      await costs.updateSettings(ada, settings({ reminderDay: 9 }));
      await expect(queries.settings(projectId)).resolves.toMatchObject({
        baseCurrency: "INR",
        reminderDay: 9,
        hasEntries: true,
      });
    });
  });
});

describeDb("COST-7 monthly reminder (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let lead: string;
  let bob: string;
  let costs: ReturnType<typeof createCostService>;
  let queries: ReturnType<typeof createCostQueries>;
  let stkId: string;
  const projectId = projectIdByKey("STK");

  /** Runs the job at an instant; returns its counts. */
  const runAt = (iso: string) => createCostReminderJob(db, { now: () => new Date(iso) }).run();

  async function reminders() {
    const result = await db.execute(sql`
      SELECT user_id::text, type::text, entity_type::text, dedupe_key, meta, actor_id::text
      FROM notifications WHERE type = 'cost_reminder' ORDER BY dedupe_key
    `);
    return rowsOf(
      result,
      z.object({
        user_id: z.string(),
        type: z.string(),
        entity_type: z.string(),
        dedupe_key: z.string(),
        meta: z.unknown(),
        actor_id: z.string().nullable(),
      }),
    );
  }

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    lead = await createTestUser(db, "Lena Lead");
    bob = await createTestUser(db, "Bob Builder");
    const project = await db.execute(sql`
      UPDATE projects SET lead_id = ${lead}::uuid WHERE key = 'STK' RETURNING id::text
    `);
    stkId = rowsOf(project, z.object({ id: z.string() }))[0]?.id ?? "";
    costs = createCostService(db, { runAtomic: transactionRunner(db) });
    queries = createCostQueries(db);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM notifications`);
    await db.execute(sql`DELETE FROM cost_entries`);
    await db.execute(sql`DELETE FROM cost_items`);
    await db.execute(sql`DELETE FROM cost_settings`);
  });

  it("does nothing without cost items", async () => {
    await expect(runAt("2030-03-10T03:00:00Z")).resolves.toEqual({ projects: 0, notified: 0 });
  });

  it("reminds the lead from the reminder day on, once per month (dedupe across runs)", async () => {
    await costs.updateSettings(lead, settings({ reminderDay: 5 }));
    const a = await costs.createItem(lead, item({ name: "Hosting" }));
    await costs.createItem(lead, item({ name: "OCR", billingCycle: "usage" }));
    // A yearly item renewing in June is not expected in February.
    await costs.createItem(
      lead,
      item({ name: "Domain", billingCycle: "yearly", currency: "INR", renewsOn: "2029-06-01" }),
    );
    await costs
      .createItem(lead, item({ name: "Gone" }))
      .then(({ id }) => costs.setActive(lead, id, false));

    // 4 March, 22:59 IST: still before the 5th.
    await expect(runAt("2030-03-04T17:29:00Z")).resolves.toEqual({ projects: 0, notified: 0 });
    // 5 March 00:30 IST is still 4 March in UTC: Stockkart's calendar counts.
    await expect(runAt("2030-03-04T19:00:00Z")).resolves.toEqual({ projects: 1, notified: 1 });
    await expect(runAt("2030-03-05T03:00:00Z")).resolves.toEqual({ projects: 1, notified: 0 });
    await expect(runAt("2030-03-20T03:00:00Z")).resolves.toEqual({ projects: 1, notified: 0 });

    const rows = await reminders();
    expect(rows).toEqual([
      {
        user_id: lead,
        type: "cost_reminder",
        entity_type: "cost_item",
        dedupe_key: `cost_reminder:${stkId}:2030-02:${lead}`,
        meta: { month: "2030-02", missingCount: 2 },
        actor_id: null,
      },
    ]);

    // The bell: a system entry that opens the costs page on February.
    const [view] = await createNotificationQueries(db).latest(lead, 5);
    expect(view?.target).toEqual({
      kind: "costs",
      title: "February 2030 costs",
      href: "/STK/costs?month=2030-02",
    });
    expect(view && notificationText(view)).toBe(
      "reminds you: February 2030 costs are not added yet (2 items missing)",
    );

    // Completing February ends it: the page banner and My Work card agree with the job.
    expect(await queries.reminder(projectId, "2030-03-20")).toEqual({
      projectKey: "STK",
      month: "2030-02",
      missingCount: 2,
    });
    await costs.setEntry(lead, entry(a.id));
    expect((await queries.remindersFor(lead, "2030-03-20"))[0]?.missingCount).toBe(1);
    expect(await queries.remindersFor(bob, "2030-03-20")).toEqual([]);
  });

  it("sends nothing when last month is complete", async () => {
    const a = await costs.createItem(lead, item({ name: "Hosting" }));
    const b = await costs.createItem(lead, item({ name: "Free", billingCycle: "usage" }));
    await costs.setEntry(lead, entry(a.id));
    await costs.setEntry(lead, entry(b.id, { kind: "no_charge", amountMinor: 0 }));
    await expect(runAt("2030-03-02T03:00:00Z")).resolves.toEqual({ projects: 0, notified: 0 });
    expect(await queries.reminder(projectId, "2030-03-02")).toBeNull();
    expect(await reminders()).toEqual([]);
  });

  it("reminds about December in January, to the chosen recipients, and the yearly item when due", async () => {
    await costs.updateSettings(lead, settings({ reminderUserIds: [bob] }));
    await costs.createItem(
      lead,
      item({ name: "Domain", billingCycle: "yearly", currency: "INR", renewsOn: "2029-12-15" }),
    );
    await expect(runAt("2031-01-01T03:00:00Z")).resolves.toEqual({ projects: 1, notified: 1 });
    const [row] = await reminders();
    expect(row).toMatchObject({
      user_id: bob,
      dedupe_key: `cost_reminder:${stkId}:2030-12:${bob}`,
      meta: { month: "2030-12", missingCount: 1 },
    });
    // February: a new month, a new reminder (yearly item not due then: nothing missing).
    await expect(runAt("2031-02-01T03:00:00Z")).resolves.toEqual({ projects: 0, notified: 0 });
  });

  it("falls back to the lead when every chosen recipient was deleted", async () => {
    const carl = await createTestUser(db, "Carl Gone");
    await costs.updateSettings(lead, settings({ reminderUserIds: [carl] }));
    await db.execute(sql`DELETE FROM users WHERE id = ${carl}::uuid`);
    await costs.createItem(lead, item({ name: "Hosting" }));
    await expect(runAt("2030-03-02T03:00:00Z")).resolves.toEqual({ projects: 1, notified: 1 });
    expect((await reminders()).map((row) => row.user_id)).toEqual([lead]);
  });

  it("does not count items added after the month", async () => {
    await costs.createItem(lead, item({ name: "Hosting" }));
    // The item was created today, so a month before today never misses it.
    const today = localDate(new Date());
    const thisMonth = periodToMonth(today);
    expect(await queries.reminder(projectId, `${thisMonth}-28`)).toBeNull();
  });
});
