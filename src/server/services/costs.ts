import { type SQL, sql } from "drizzle-orm";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { z } from "zod";

import { copyLastMonthPlan } from "@/lib/costs/calc";
import {
  BILLING_CYCLES,
  COST_CATEGORIES,
  COST_CURRENCIES,
  COST_ENTRY_KINDS,
  COST_ITEMS_MAX,
  COST_TIMEZONE,
  type CostCurrency,
  DEFAULT_BASE_CURRENCY,
  DEFAULT_REMINDER_DAY,
  MAX_AMOUNT_MINOR,
} from "@/lib/costs/constants";
import { STOCKKART_DEFAULT_COSTS } from "@/lib/costs/defaults";
import { convertToBase } from "@/lib/costs/money";
import { addMonths, isMonth, localDate, type Month, monthToPeriod } from "@/lib/costs/month";
import {
  type addDefaultCostsInput,
  type clearCostEntryInput,
  type copyLastMonthInput,
  type createCostItemInput,
  type moveCostItemInput,
  type setCostEntryInput,
  type updateCostItemInput,
  type updateCostSettingsInput,
} from "@/lib/costs/schemas";
import {
  type CostEntryView,
  type CostItemView,
  type CostReminder,
  type CostServiceOption,
  type CostSettingsView,
  type CostUserOption,
} from "@/lib/costs/views";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase, type RunAtomic } from "@/server/db/types";

import { conflict, invalid, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";
import { notificationsInsert } from "./notifications";
import { type IdRef, rowsOf, uuidOrNull } from "./sql";

/**
 * Costs (IMR, COST-1…COST-8): cost items, their monthly entries and the project's costs
 * settings, plus the COST-7 monthly reminder. Item and entry writes log `activity` rows
 * (entity_type `cost_item`) in the statement of the change. Amounts never go into
 * activity rows or logs: an entry change records only its month and kind.
 */

export type CreateCostItemData = z.output<typeof createCostItemInput>;
export type UpdateCostItemData = z.output<typeof updateCostItemInput>;
export type MoveCostItemData = z.output<typeof moveCostItemInput>;
export type SetCostEntryData = z.output<typeof setCostEntryInput>;
export type ClearCostEntryData = z.output<typeof clearCostEntryInput>;
export type CopyLastMonthData = z.output<typeof copyLastMonthInput>;
export type AddDefaultCostsData = z.output<typeof addDefaultCostsInput>;
export type UpdateCostSettingsData = z.output<typeof updateCostSettingsInput>;

const NAME_CONSTRAINT = "cost_items_project_name_unique";
const TZ = sql.raw(`'${COST_TIMEZONE}'`);

const isNameTaken = (error: unknown) => {
  const info = pgErrorInfo(error);
  return info?.code === UNIQUE_VIOLATION && info.constraint === NAME_CONSTRAINT;
};

/**
 * The per-project costs lock (transaction-scoped advisory lock `hq.costs:<projectId>`):
 * entry writes take it shared, the settings save exclusive, so an entry is never converted
 * against a base currency that is being changed at the same time.
 */
function costsLock(projectId: string, mode: "shared" | "exclusive"): SQL {
  const key = sql`hashtextextended(${`hq.costs:${projectId}`}, 0)`;
  return mode === "shared"
    ? sql`SELECT pg_advisory_xact_lock_shared(${key})`
    : sql`SELECT pg_advisory_xact_lock(${key})`;
}

/** A bigint column read as text → a safe integer (`MAX_AMOUNT_MINOR` keeps it safe). */
const minor = z.coerce
  .number()
  .refine((value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_AMOUNT_MINOR);
const month = z
  .string()
  .refine(isMonth)
  .transform((value) => value as Month);

const itemRow = z.object({
  id: z.string(),
  name: z.string(),
  vendor: z.string().nullable(),
  category: z.enum(COST_CATEGORIES),
  billing_cycle: z.enum(BILLING_CYCLES),
  currency: z.enum(COST_CURRENCIES),
  expected_amount_minor: minor.nullable(),
  renews_on: z.string().nullable(),
  notes: z.string().nullable(),
  active: z.boolean(),
  position: z.string(),
  service_id: z.string().nullable(),
  service_name: z.string().nullable(),
  service_slug: z.string().nullable(),
  created_month: month,
});

function toItem(row: z.infer<typeof itemRow>): CostItemView {
  return {
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    category: row.category,
    billingCycle: row.billing_cycle,
    currency: row.currency,
    expectedAmountMinor: row.expected_amount_minor,
    renewsOn: row.renews_on,
    notes: row.notes,
    active: row.active,
    position: row.position,
    service:
      row.service_id && row.service_name !== null && row.service_slug !== null
        ? { id: row.service_id, name: row.service_name, slug: row.service_slug }
        : null,
    createdMonth: row.created_month,
  };
}

const entryRow = z.object({
  id: z.string(),
  item_id: z.string(),
  month,
  amount_minor: minor,
  currency: z.enum(COST_CURRENCIES),
  fx_rate: z.string().nullable(),
  base_amount_minor: minor,
  kind: z.enum(COST_ENTRY_KINDS),
  notes: z.string().nullable(),
  entered_by_name: z.string().nullable(),
});

function toEntry(row: z.infer<typeof entryRow>): CostEntryView {
  return {
    id: row.id,
    itemId: row.item_id,
    month: row.month,
    amountMinor: row.amount_minor,
    currency: row.currency,
    fxRate: row.fx_rate,
    baseAmountMinor: row.base_amount_minor,
    kind: row.kind,
    notes: row.notes,
    enteredByName: row.entered_by_name,
  };
}

/** Live items of a project in list order (archived ones included; deleted ones never). */
const itemsSql = (projectId: IdRef) => sql`
  SELECT i.id::text, i.name, i.vendor, i.category::text, i.billing_cycle::text, i.currency,
    i.expected_amount_minor::text, i.renews_on::text, i.notes, i.active, i.position,
    s.id::text AS service_id, s.name AS service_name, s.slug AS service_slug,
    to_char(i.created_at AT TIME ZONE ${TZ}, 'YYYY-MM') AS created_month
  FROM cost_items i
  LEFT JOIN services s ON s.id = i.service_id AND s.deleted_at IS NULL
  WHERE i.project_id = ${projectId}::uuid AND i.deleted_at IS NULL
  ORDER BY i.position, i.id`;

/** Entries of the project's live items with `from` ≤ month ≤ `to`. */
const entriesSql = (projectId: IdRef, from: Month, to: Month) => sql`
  SELECT e.id::text, e.item_id::text, to_char(e.period, 'YYYY-MM') AS month,
    e.amount_minor::text, e.currency, e.fx_rate_to_base::text AS fx_rate,
    e.base_amount_minor::text, e.kind::text, e.notes, u.name AS entered_by_name
  FROM cost_entries e
  JOIN cost_items i ON i.id = e.item_id AND i.deleted_at IS NULL
  LEFT JOIN users u ON u.id = e.entered_by
  WHERE i.project_id = ${projectId}::uuid
    AND e.period BETWEEN ${monthToPeriod(from)}::date AND ${monthToPeriod(to)}::date
  ORDER BY e.period, e.item_id`;

/**
 * COST-7: whether item `i` is expected to have an entry in the month starting `period`
 * (the SQL twin of `isExpectedInMonth` in lib/costs/calc.ts; keep them equal): live and
 * active, added by that month (Stockkart time), and monthly / usage, or yearly with its
 * renewal in that month.
 */
const expectedIn = (period: SQL) => sql`(i.deleted_at IS NULL AND i.active
  AND to_char(i.created_at AT TIME ZONE ${TZ}, 'YYYY-MM') <= to_char(${period}, 'YYYY-MM')
  AND (i.billing_cycle <> 'yearly' OR (i.renews_on IS NOT NULL
    AND extract(month FROM i.renews_on) = extract(month FROM ${period}))))`;

/**
 * COST-7 reminder rows for `today` ("YYYY-MM-DD", Stockkart time): one per live project
 * whose reminder day has come (day of `today` ≥ `reminder_day`, default 1) and whose
 * PREVIOUS month has expected items without an entry. Columns: `project_id`,
 * `project_key`, `month` ("YYYY-MM"), `missing_count`, `first_item` (the bell entry's
 * entity) and `recipients` (the `reminder_user_ids` that still exist, or the project lead
 * when none do).
 * Shared by the cron job, the costs page banner and the My Work card, so all three agree.
 */
export function costReminderRows(today: string): SQL {
  const period = sql`(date_trunc('month', ${today}::date) - interval '1 month')::date`;
  return sql`
    SELECT r.project_id, r.project_key, to_char(r.period, 'YYYY-MM') AS month,
      r.missing_count, r.first_item, r.recipients
    FROM (
      SELECT p.id AS project_id, p.key AS project_key, ${period} AS period,
        coalesce(s.reminder_day, ${DEFAULT_REMINDER_DAY}) AS reminder_day,
        CASE
          WHEN cardinality(r_live.ids) > 0 THEN r_live.ids
          WHEN p.lead_id IS NOT NULL THEN ARRAY[p.lead_id]
          ELSE '{}'::uuid[]
        END AS recipients,
        m.missing_count, m.first_item
      FROM projects p
      LEFT JOIN cost_settings s ON s.project_id = p.id
      -- Stored recipients who still exist; none left means the lead (as when none are set).
      CROSS JOIN LATERAL (
        SELECT ARRAY(SELECT u.id FROM users u
          WHERE u.id = ANY(coalesce(s.reminder_user_ids, '{}'::uuid[]))) AS ids
      ) r_live
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS missing_count,
          (array_agg(i.id ORDER BY i.position, i.id))[1] AS first_item
        FROM cost_items i
        WHERE i.project_id = p.id AND ${expectedIn(period)}
          AND NOT EXISTS (
            SELECT 1 FROM cost_entries e WHERE e.item_id = i.id AND e.period = ${period}
          )
      ) m
      WHERE p.archived_at IS NULL
    ) r
    WHERE extract(day FROM ${today}::date) >= r.reminder_day AND r.missing_count > 0`;
}

const reminderRow = z.object({
  project_key: z.string(),
  month,
  missing_count: z.number(),
});

const toReminder = (row: z.infer<typeof reminderRow>): CostReminder => ({
  projectKey: row.project_key,
  month: row.month,
  missingCount: row.missing_count,
});

export interface CostServiceOptions {
  runAtomic: RunAtomic;
  read?: Read;
}

export function createCostService(db: AppDatabase, options: CostServiceOptions) {
  const read = options.read ?? directRead;

  async function projectByKey(key: string) {
    const result = await read(
      db.execute(sql`
        SELECT p.id::text, coalesce(s.base_currency, ${DEFAULT_BASE_CURRENCY}) AS base_currency
        FROM projects p LEFT JOIN cost_settings s ON s.project_id = p.id
        WHERE p.key = ${key} AND p.archived_at IS NULL
      `),
    );
    const [row] = rowsOf(
      result,
      z.object({ id: z.string(), base_currency: z.enum(COST_CURRENCIES) }),
    );
    if (!row) throw notFound(`Project ${key}`);
    return { id: row.id, baseCurrency: row.base_currency };
  }

  /** A live item with its project's base currency. */
  async function liveItem(itemId: string) {
    const result = await read(
      db.execute(sql`
        SELECT i.id::text, i.project_id::text, i.currency, i.position,
          coalesce(s.base_currency, ${DEFAULT_BASE_CURRENCY}) AS base_currency
        FROM cost_items i LEFT JOIN cost_settings s ON s.project_id = i.project_id
        WHERE i.id = ${itemId}::uuid AND i.deleted_at IS NULL
      `),
    );
    const [row] = rowsOf(
      result,
      z.object({
        id: z.string(),
        project_id: z.string(),
        currency: z.enum(COST_CURRENCIES),
        position: z.string(),
        base_currency: z.enum(COST_CURRENCIES),
      }),
    );
    if (!row) throw notFound("Cost item");
    return row;
  }

  /** The project of a live service (null without one); callers check it is theirs. */
  async function serviceProject(serviceId: string | null): Promise<string | null> {
    if (!serviceId) return null;
    const result = await read(
      db.execute(sql`
        SELECT project_id::text FROM services WHERE id = ${serviceId}::uuid AND deleted_at IS NULL
      `),
    );
    const [row] = rowsOf(result, z.object({ project_id: z.string() }));
    if (!row) throw notFound("Service");
    return row.project_id;
  }

  /** Only the project's own services are offered; anything else is "not found". */
  function checkSameProject(serviceProjectId: string | null, projectId: string) {
    if (serviceProjectId !== null && serviceProjectId !== projectId) throw notFound("Service");
  }

  async function listOrder(projectId: string) {
    const result = await db.execute(sql`
      SELECT id::text, position FROM cost_items
      WHERE project_id = ${projectId}::uuid AND deleted_at IS NULL
      ORDER BY position, id
    `);
    return rowsOf(result, z.object({ id: z.string(), position: z.string() }));
  }

  function keyAt(others: { position: string }[], index: number): string | null {
    const before = others[index - 1]?.position ?? null;
    const after = others[index]?.position ?? null;
    if (before !== null && after !== null && before >= after) return null;
    return generateKeyBetween(before, after);
  }

  function assertRoom(count: number, adding: number) {
    if (count + adding > COST_ITEMS_MAX) {
      throw invalid(`A project can have at most ${COST_ITEMS_MAX} cost items`);
    }
  }

  return {
    /** COST-1: a new item at the end of the list. Names are unique (case-insensitive). */
    async createItem(actorId: string, input: CreateCostItemData): Promise<{ id: string }> {
      const [project, serviceProjectId] = await Promise.all([
        projectByKey(input.projectKey),
        serviceProject(input.serviceId),
      ]);
      checkSameProject(serviceProjectId, project.id);
      const order = await listOrder(project.id);
      assertRoom(order.length, 1);
      const position = generateKeyBetween(order.at(-1)?.position ?? null, null);
      let result: unknown;
      try {
        result = await db.execute(sql`
          WITH inserted AS (
            INSERT INTO cost_items (project_id, name, vendor, category, billing_cycle, currency,
              expected_amount_minor, renews_on, service_id, notes, position)
            VALUES (${project.id}::uuid, ${input.name}, ${input.vendor},
              ${input.category}::cost_category, ${input.billingCycle}::billing_cycle,
              ${input.currency}, ${input.expectedAmountMinor}::bigint, ${input.renewsOn}::date,
              ${uuidOrNull(input.serviceId)}, ${input.notes}, ${position})
            RETURNING id, name
          ),
          created_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value)
            SELECT 'cost_item', id, ${actorId}::uuid, 'created', name FROM inserted
          )
          SELECT id::text FROM inserted
        `);
      } catch (error) {
        if (isNameTaken(error)) throw conflict(`There is already a cost item “${input.name}”`);
        throw error;
      }
      const [row] = rowsOf(result, z.object({ id: z.string() }));
      if (!row) throw notFound("Cost item");
      return row;
    },

    /** Edit every form field; one `activity` row per changed field, same statement. */
    async updateItem(actorId: string, input: UpdateCostItemData): Promise<{ id: string }> {
      const [item, serviceProjectId] = await Promise.all([
        liveItem(input.itemId),
        serviceProject(input.serviceId),
      ]);
      checkSameProject(serviceProjectId, item.project_id);
      let result: unknown;
      try {
        // `old` locks the row, so the activity rows record what was actually replaced.
        result = await db.execute(sql`
          WITH old AS (
            SELECT id, name, vendor, category, billing_cycle, currency, expected_amount_minor,
              renews_on, service_id, notes
            FROM cost_items
            WHERE id = ${input.itemId}::uuid AND deleted_at IS NULL
            FOR UPDATE
          ),
          updated AS (
            UPDATE cost_items SET name = ${input.name}, vendor = ${input.vendor},
              category = ${input.category}::cost_category,
              billing_cycle = ${input.billingCycle}::billing_cycle,
              currency = ${input.currency},
              expected_amount_minor = ${input.expectedAmountMinor}::bigint,
              renews_on = ${input.renewsOn}::date, service_id = ${uuidOrNull(input.serviceId)},
              notes = ${input.notes}, updated_at = now()
            FROM old
            WHERE cost_items.id = old.id
            RETURNING cost_items.id
          ),
          changes AS (
            SELECT f.field, f.from_value, f.to_value
            FROM old, LATERAL (VALUES
              ('name', old.name, ${input.name}::text),
              ('vendor', old.vendor, ${input.vendor}::text),
              ('category', old.category::text, ${input.category}::text),
              ('billingCycle', old.billing_cycle::text, ${input.billingCycle}::text),
              ('currency', old.currency, ${input.currency}::text),
              ('expectedAmount', old.expected_amount_minor::text,
                ${input.expectedAmountMinor}::bigint::text),
              ('renewsOn', old.renews_on::text, ${input.renewsOn}::date::text),
              ('serviceId', old.service_id::text, ${input.serviceId}::uuid::text),
              ('notes', old.notes, ${input.notes}::text)
            ) AS f(field, from_value, to_value)
            WHERE f.from_value IS DISTINCT FROM f.to_value
          ),
          change_activity AS (
            INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
              to_value)
            SELECT 'cost_item', u.id, ${actorId}::uuid, 'updated', c.field,
              -- The expected amount is a plan, not a payment; still, keep money out of the
              -- activity feed (COST-9): record only that it changed, neither side.
              CASE WHEN c.field = 'expectedAmount' THEN NULL ELSE c.from_value END,
              CASE WHEN c.field = 'expectedAmount' THEN NULL ELSE c.to_value END
            FROM updated u, changes c
          )
          SELECT id::text FROM updated
        `);
      } catch (error) {
        if (isNameTaken(error)) throw conflict(`There is already a cost item “${input.name}”`);
        throw error;
      }
      const [row] = rowsOf(result, z.object({ id: z.string() }));
      if (!row) throw notFound("Cost item");
      return row;
    },

    /** Archive (no longer expected; entries still count) or reactivate. */
    async setActive(actorId: string, itemId: string, active: boolean): Promise<void> {
      const result = await db.execute(sql`
        WITH changed AS (
          UPDATE cost_items SET active = ${active}, updated_at = now()
          WHERE id = ${itemId}::uuid AND deleted_at IS NULL
          RETURNING id
        ),
        change_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value)
          SELECT 'cost_item', id, ${actorId}::uuid,
            ${active ? "reactivated" : "archived"}, 'active', ${String(active)}
          FROM changed
        )
        SELECT id::text FROM changed
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) throw notFound("Cost item");
    },

    /** Soft delete (§9.3): the item and its entries leave every page and total. */
    async deleteItem(actorId: string, itemId: string): Promise<void> {
      const result = await db.execute(sql`
        WITH deleted AS (
          UPDATE cost_items SET deleted_at = now(), updated_at = now()
          WHERE id = ${itemId}::uuid AND deleted_at IS NULL
          RETURNING id
        ),
        delete_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action)
          SELECT 'cost_item', id, ${actorId}::uuid, 'deleted' FROM deleted
        )
        SELECT id::text FROM deleted
      `);
      if (rowsOf(result, z.object({ id: z.string() })).length === 0) throw notFound("Cost item");
    },

    /** List order: a fractional key between the new neighbours (respaced on a tie). */
    async moveItem(_actorId: string, input: MoveCostItemData): Promise<void> {
      const item = await liveItem(input.itemId);
      const others = (await listOrder(item.project_id)).filter((row) => row.id !== item.id);
      const index = Math.min(input.index, others.length);
      let position = keyAt(others, index);
      let respace: SQL | null = null;
      if (position === null) {
        const keys = generateNKeysBetween(null, null, others.length);
        const respaced = others.map((row, i) => ({ id: row.id, position: keys[i] ?? "" }));
        respace = sql`
          UPDATE cost_items SET position = r.position
          FROM jsonb_to_recordset(${JSON.stringify(respaced)}::jsonb) AS r(id uuid, position text)
          WHERE cost_items.id = r.id
        `;
        position = keyAt(respaced, index) ?? generateKeyBetween(null, null);
      }
      // Ordering is not a field change: no activity row (like services).
      const move = sql`
        UPDATE cost_items SET position = ${position}
        WHERE id = ${item.id}::uuid AND deleted_at IS NULL
        RETURNING id::text
      `;
      const results = await options.runAtomic(respace ? [respace, move] : [move]);
      if (rowsOf(results.at(-1), z.object({ id: z.string() })).length === 0) {
        throw notFound("Cost item");
      }
    },

    /**
     * COST-6 "Add Stockkart defaults": the known items without amounts, linked to the
     * service-registry entry of the same slug when it exists. Idempotent by name (the
     * partial unique index, `ON CONFLICT DO NOTHING`). Returns the names it created.
     */
    async addDefaults(actorId: string, input: AddDefaultCostsData): Promise<{ created: string[] }> {
      const project = await projectByKey(input.projectKey);
      const live = await db.execute(sql`
        SELECT lower(name) AS name, position FROM cost_items
        WHERE project_id = ${project.id}::uuid AND deleted_at IS NULL
        ORDER BY position, id
      `);
      const existing = rowsOf(live, z.object({ name: z.string(), position: z.string() }));
      const names = new Set(existing.map((row) => row.name));
      const missing = STOCKKART_DEFAULT_COSTS.filter((item) => !names.has(item.name.toLowerCase()));
      if (missing.length === 0) return { created: [] };
      assertRoom(existing.length, missing.length);
      const keys = generateNKeysBetween(existing.at(-1)?.position ?? null, null, missing.length);
      const rows = missing.map((item, i) => ({
        name: item.name,
        vendor: item.vendor,
        category: item.category,
        billing_cycle: item.billingCycle,
        currency: item.currency,
        service_slug: item.serviceSlug,
        position: keys[i] ?? "",
      }));
      // Still `ON CONFLICT DO NOTHING`: a concurrent click may have added some meanwhile.
      const result = await db.execute(sql`
        WITH input AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
            AS r(name text, vendor text, category text, billing_cycle text, currency text,
              service_slug text, position text)
        ),
        inserted AS (
          INSERT INTO cost_items (project_id, name, vendor, category, billing_cycle, currency,
            service_id, position)
          SELECT ${project.id}::uuid, r.name, r.vendor, r.category::cost_category,
            r.billing_cycle::billing_cycle, r.currency,
            (SELECT s.id FROM services s WHERE s.project_id = ${project.id}::uuid
              AND s.slug = r.service_slug AND s.deleted_at IS NULL),
            r.position
          FROM input r
          ON CONFLICT (project_id, lower(name)) WHERE deleted_at IS NULL DO NOTHING
          RETURNING id, name, position
        ),
        created_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, to_value, meta)
          SELECT 'cost_item', id, ${actorId}::uuid, 'created', name,
            '{"source":"defaults"}'::jsonb
          FROM inserted
        )
        SELECT name FROM inserted ORDER BY position
      `);
      return { created: rowsOf(result, z.object({ name: z.string() })).map((row) => row.name) };
    },

    /**
     * COST-2 one month's amount (insert or replace). In the base currency the base amount is
     * the amount; otherwise `fxRate` is required and the base amount is amount × rate
     * (half-up). A "no charge" month is stored as 0 in the base currency. The write holds
     * the project's costs lock (shared) and re-checks the base currency it converted to,
     * so a concurrent settings change cannot leave a wrongly converted entry.
     */
    async setEntry(
      actorId: string,
      input: SetCostEntryData,
    ): Promise<{ id: string; baseAmountMinor: number; fxRate: string | null }> {
      const item = await liveItem(input.itemId);
      const base = item.base_currency;
      const noCharge = input.kind === "no_charge";
      const currency: CostCurrency = noCharge ? base : input.currency;
      const amount = noCharge ? 0 : input.amountMinor;
      let fxRate: string | null = null;
      let baseAmount = amount;
      if (currency !== base) {
        if (!input.fxRate) throw invalid(`Enter the ${currency} → ${base} rate`);
        fxRate = input.fxRate;
        const converted = convertToBase(amount, fxRate);
        if (converted === null) throw invalid("That amount is too large in the base currency");
        baseAmount = converted;
      }
      const period = monthToPeriod(input.month);
      // Shared lock vs the settings save's exclusive one (same key): an entry and a base
      // currency change never interleave. The upsert is a SECOND statement, so its snapshot
      // is taken after the lock and its guard sees any settings change committed before.
      const results = await options.runAtomic([
        costsLock(item.project_id, "shared"),
        sql`
        WITH guard AS (
          SELECT 1 FROM cost_items i
          LEFT JOIN cost_settings s ON s.project_id = i.project_id
          WHERE i.id = ${item.id}::uuid AND i.deleted_at IS NULL
            AND coalesce(s.base_currency, ${DEFAULT_BASE_CURRENCY}) = ${base}
        ),
        old AS (
          SELECT kind FROM cost_entries
          WHERE item_id = ${item.id}::uuid AND period = ${period}::date
        ),
        saved AS (
          INSERT INTO cost_entries (item_id, period, amount_minor, currency, fx_rate_to_base,
            base_amount_minor, kind, notes, entered_by)
          SELECT ${item.id}::uuid, ${period}::date, ${amount}::bigint, ${currency},
            ${fxRate}::numeric, ${baseAmount}::bigint, ${input.kind}::cost_entry_kind,
            ${input.notes}, ${actorId}::uuid
          FROM guard
          ON CONFLICT (item_id, period) DO UPDATE SET amount_minor = EXCLUDED.amount_minor,
            currency = EXCLUDED.currency, fx_rate_to_base = EXCLUDED.fx_rate_to_base,
            base_amount_minor = EXCLUDED.base_amount_minor, kind = EXCLUDED.kind,
            notes = EXCLUDED.notes, entered_by = EXCLUDED.entered_by, updated_at = now()
          RETURNING id, kind
        ),
        entry_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value,
            to_value)
          SELECT 'cost_item', ${item.id}::uuid, ${actorId}::uuid, 'entry_set',
            ${`entry:${input.month}`}, (SELECT kind::text FROM old), kind::text
          FROM saved
        )
        SELECT id::text FROM saved
      `,
      ]);
      const [row] = rowsOf(results.at(-1), z.object({ id: z.string() }));
      if (!row) throw conflict("The costs settings changed; reload and try again");
      return { id: row.id, baseAmountMinor: baseAmount, fxRate };
    },

    /** Removes a month's entry (the month is "not entered" again). */
    async clearEntry(actorId: string, input: ClearCostEntryData): Promise<void> {
      const period = monthToPeriod(input.month);
      const result = await db.execute(sql`
        WITH removed AS (
          DELETE FROM cost_entries e
          USING cost_items i
          WHERE e.item_id = ${input.itemId}::uuid AND e.period = ${period}::date
            AND i.id = e.item_id AND i.deleted_at IS NULL
          RETURNING e.item_id, e.kind
        ),
        clear_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, from_value)
          SELECT 'cost_item', item_id, ${actorId}::uuid, 'entry_cleared',
            ${`entry:${input.month}`}, kind::text
          FROM removed
        )
        SELECT item_id::text FROM removed
      `);
      if (rowsOf(result, z.object({ item_id: z.string() })).length === 0) {
        throw notFound("Entry");
      }
    },

    /**
     * COST-5 "Copy last month": pre-fills this month's missing monthly / usage entries from
     * last month as estimates (`copyLastMonthPlan`). Never overwrites an entry
     * (`ON CONFLICT DO NOTHING`). Returns how many it added.
     */
    async copyLastMonth(actorId: string, input: CopyLastMonthData): Promise<{ copied: number }> {
      const project = await projectByKey(input.projectKey);
      const queries = createCostQueries(db, { read });
      const [items, entries] = await Promise.all([
        queries.items(project.id),
        queries.entriesBetween(project.id, addMonths(input.month, -1), input.month),
      ]);
      const plan = copyLastMonthPlan(items, entries, input.month);
      if (plan.length === 0) return { copied: 0 };
      const rows = plan.map((entry) => ({
        item_id: entry.itemId,
        amount_minor: entry.amountMinor,
        currency: entry.currency,
        fx_rate: entry.fxRate,
        base_amount_minor: entry.baseAmountMinor,
        kind: entry.kind,
      }));
      const period = monthToPeriod(input.month);
      const result = await db.execute(sql`
        WITH input AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
            AS r(item_id uuid, amount_minor bigint, currency text, fx_rate numeric,
              base_amount_minor bigint, kind text)
        ),
        saved AS (
          INSERT INTO cost_entries (item_id, period, amount_minor, currency, fx_rate_to_base,
            base_amount_minor, kind, entered_by)
          SELECT r.item_id, ${period}::date, r.amount_minor, r.currency, r.fx_rate,
            r.base_amount_minor, r.kind::cost_entry_kind, ${actorId}::uuid
          FROM input r
          JOIN cost_items i ON i.id = r.item_id AND i.project_id = ${project.id}::uuid
            AND i.deleted_at IS NULL
          ON CONFLICT (item_id, period) DO NOTHING
          RETURNING item_id, kind
        ),
        copy_activity AS (
          INSERT INTO activity (entity_type, entity_id, actor_id, action, field, to_value, meta)
          SELECT 'cost_item', item_id, ${actorId}::uuid, 'entry_set', ${`entry:${input.month}`},
            kind::text, '{"source":"copy_last_month"}'::jsonb
          FROM saved
        )
        SELECT count(*)::int AS copied FROM saved
      `);
      const [row] = rowsOf(result, z.object({ copied: z.number() }));
      return { copied: row?.copied ?? 0 };
    },

    /**
     * COST-8 settings (created on the first save). Recipients are kept only if they are HQ
     * users. The base currency cannot change once the project has entries: the statement
     * itself refuses it (no row), run under the project's costs lock (exclusive) so no
     * entry write (shared lock) can slip in between the check and the change.
     */
    async updateSettings(_actorId: string, input: UpdateCostSettingsData): Promise<void> {
      const project = await projectByKey(input.projectKey);
      const results = await options.runAtomic([
        costsLock(project.id, "exclusive"),
        sql`
        WITH has_entries AS (
          SELECT EXISTS (
            SELECT 1 FROM cost_entries e JOIN cost_items i ON i.id = e.item_id
            WHERE i.project_id = ${project.id}::uuid
          ) AS yes
        ),
        saved AS (
          INSERT INTO cost_settings (project_id, base_currency, monthly_budget_minor,
            reminder_day, reminder_user_ids, default_usd_to_inr)
          SELECT ${project.id}::uuid, ${input.baseCurrency}, ${input.monthlyBudgetMinor}::bigint,
            ${input.reminderDay}::int,
            ARRAY(SELECT u.id FROM users u WHERE u.id IN (
              SELECT value::uuid FROM jsonb_array_elements_text(
                ${JSON.stringify(input.reminderUserIds)}::jsonb))
              ORDER BY u.name, u.id),
            ${input.defaultUsdToInr}::numeric
          FROM has_entries
          WHERE NOT has_entries.yes OR ${input.baseCurrency} = coalesce(
            (SELECT base_currency FROM cost_settings WHERE project_id = ${project.id}::uuid),
            ${DEFAULT_BASE_CURRENCY})
          ON CONFLICT (project_id) DO UPDATE SET base_currency = EXCLUDED.base_currency,
            monthly_budget_minor = EXCLUDED.monthly_budget_minor,
            reminder_day = EXCLUDED.reminder_day,
            reminder_user_ids = EXCLUDED.reminder_user_ids,
            default_usd_to_inr = EXCLUDED.default_usd_to_inr, updated_at = now()
          RETURNING id
        )
        SELECT id::text FROM saved
      `,
      ]);
      if (rowsOf(results.at(-1), z.object({ id: z.string() })).length === 0) {
        throw conflict("The base currency cannot change once costs are entered");
      }
    },
  };
}

export type CostService = ReturnType<typeof createCostService>;

/**
 * Reads of /<KEY>/costs, the export, the costs banner and the My Work card. Every query
 * takes ids or `IdRef` subqueries, so a page starts them together: ONE round trip on Neon
 * (README "Performance").
 */
export function createCostQueries(db: AppDatabase, { read = directRead }: { read?: Read } = {}) {
  return {
    async items(projectId: IdRef): Promise<CostItemView[]> {
      const result = await read(db.execute(itemsSql(projectId)));
      return rowsOf(result, itemRow).map(toItem);
    },

    /** Entries from `from` to `to` (months, inclusive). */
    async entriesBetween(projectId: IdRef, from: Month, to: Month): Promise<CostEntryView[]> {
      const result = await read(db.execute(entriesSql(projectId, from, to)));
      return rowsOf(result, entryRow).map(toEntry);
    },

    /**
     * The settings, or the defaults before the first save; plus the project lead and whether
     * any entry exists (then the base currency is fixed).
     */
    async settings(projectId: IdRef): Promise<CostSettingsView> {
      const result = await read(
        db.execute(sql`
          SELECT s.base_currency, s.monthly_budget_minor::text, s.reminder_day,
            CASE WHEN s.id IS NULL THEN '[]'::json ELSE to_json(ARRAY(
              SELECT u.id::text FROM users u WHERE u.id = ANY(s.reminder_user_ids)
              ORDER BY u.name, u.id)) END AS reminder_user_ids,
            s.default_usd_to_inr::text, s.id IS NOT NULL AS saved, p.lead_id::text,
            EXISTS (
              SELECT 1 FROM cost_entries e JOIN cost_items i ON i.id = e.item_id
              WHERE i.project_id = p.id
            ) AS has_entries
          FROM projects p LEFT JOIN cost_settings s ON s.project_id = p.id
          WHERE p.id = ${projectId}::uuid
        `),
      );
      const [row] = rowsOf(
        result,
        z.object({
          base_currency: z.enum(COST_CURRENCIES).nullable(),
          monthly_budget_minor: minor.nullable(),
          reminder_day: z.number().nullable(),
          reminder_user_ids: z.array(z.string()),
          default_usd_to_inr: z.string().nullable(),
          saved: z.boolean(),
          lead_id: z.string().nullable(),
          has_entries: z.boolean(),
        }),
      );
      return {
        baseCurrency: row?.base_currency ?? DEFAULT_BASE_CURRENCY,
        monthlyBudgetMinor: row?.monthly_budget_minor ?? null,
        reminderDay: row?.reminder_day ?? DEFAULT_REMINDER_DAY,
        reminderUserIds: row?.reminder_user_ids ?? [],
        defaultUsdToInr: row?.default_usd_to_inr ?? null,
        saved: row?.saved ?? false,
        leadId: row?.lead_id ?? null,
        hasEntries: row?.has_entries ?? false,
      };
    },

    /** COST-7 banner on the costs page: the project's pending month, if any. */
    async reminder(projectId: IdRef, today: string): Promise<CostReminder | null> {
      const result = await read(
        db.execute(sql`
          SELECT r.project_key, r.month, r.missing_count FROM (${costReminderRows(today)}) r
          WHERE r.project_id = ${projectId}::uuid
        `),
      );
      const [row] = rowsOf(result, reminderRow);
      return row ? toReminder(row) : null;
    },

    /** COST-7 My Work card: the pending months the user is a recipient of. */
    async remindersFor(userId: string, today: string): Promise<CostReminder[]> {
      const result = await read(
        db.execute(sql`
          SELECT r.project_key, r.month, r.missing_count FROM (${costReminderRows(today)}) r
          WHERE ${userId}::uuid = ANY(r.recipients)
          ORDER BY r.project_key
        `),
      );
      return rowsOf(result, reminderRow).map(toReminder);
    },

    /** "Linked service" picker: the project's live services. */
    async serviceOptions(projectId: IdRef): Promise<CostServiceOption[]> {
      const result = await read(
        db.execute(sql`
          SELECT id::text, name, slug FROM services
          WHERE project_id = ${projectId}::uuid AND deleted_at IS NULL
          ORDER BY position, id
        `),
      );
      return rowsOf(result, z.object({ id: z.string(), name: z.string(), slug: z.string() }));
    },

    /** Reminder recipients picker: every HQ user. */
    async userOptions(): Promise<CostUserOption[]> {
      const result = await read(
        db.execute(sql`SELECT id::text, name, email FROM users ORDER BY name, id`),
      );
      return rowsOf(result, z.object({ id: z.string(), name: z.string(), email: z.string() }));
    },
  };
}

export type CostQueries = ReturnType<typeof createCostQueries>;

/**
 * COST-7 monthly reminder job (a bell entry; no email of its own), run by `/api/cron/monthly`. ONE
 * statement: for every project due today (`costReminderRows`), a `cost_reminder` bell
 * entry per recipient with `dedupe_key = cost_reminder:<projectId>:<YYYY-MM>:<userId>`
 * and `meta = { month, missingCount }`, `ON CONFLICT DO NOTHING`; so the daily cron
 * reminds each recipient once per month, however often it runs. Returns counts only.
 */
export function createCostReminderJob(db: AppDatabase, deps: { now: () => Date }) {
  return {
    async run(): Promise<{ projects: number; notified: number }> {
      const today = localDate(deps.now());
      const result = await db.execute(sql`
        WITH due AS (${costReminderRows(today)}),
        created AS (
          ${notificationsInsert({
            actorId: null,
            source: sql`
              SELECT u.id AS user_id, 'cost_reminder'::text AS type,
                'cost_item'::text AS entity_type, d.first_item AS entity_id,
                'cost_reminder:' || d.project_id::text || ':' || d.month AS event_key,
                jsonb_build_object('month', d.month, 'missingCount', d.missing_count) AS meta
              FROM due d JOIN users u ON u.id = ANY(d.recipients)`,
          })}
        )
        SELECT (SELECT count(*)::int FROM due) AS projects,
          (SELECT count(*)::int FROM created) AS notified
      `);
      const [row] = rowsOf(result, z.object({ projects: z.number(), notified: z.number() }));
      return { projects: row?.projects ?? 0, notified: row?.notified ?? 0 };
    },
  };
}

export type CostReminderJob = ReturnType<typeof createCostReminderJob>;
