import { z } from "zod";

import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import { findSecretInText, secretErrorMessage } from "@/lib/service-registry/secrets";

import {
  BILLING_CYCLES,
  COST_CATEGORIES,
  COST_CURRENCIES,
  COST_ENTRY_KINDS,
  COST_ENTRY_NOTES_MAX,
  COST_NAME_MAX,
  COST_NOTES_MAX,
  COST_VENDOR_MAX,
  MAX_AMOUNT_MINOR,
  REMINDER_DAY_MAX,
  REMINDER_DAY_MIN,
} from "./constants";
import { parseFxRate } from "./money";
import { isMonth, type Month } from "./month";

/**
 * Zod input schemas of the costs actions (COST-1…COST-8). Isomorphic: forms validate with
 * them, the server action parses again (only that counts). Amounts arrive as integers in
 * minor units (the browser parses the typed text with `parseMoney`); rates as text and are
 * normalised to `numeric(12,6)` form here.
 */

const id = z.uuid();
const projectKey = z.string().regex(PROJECT_KEY_PATTERN);

/** Minor units: a safe, non-negative integer up to `MAX_AMOUNT_MINOR`. */
export const amountMinor = z
  .number()
  .int("Amounts are whole minor units")
  .min(0, "Amounts cannot be negative")
  .max(MAX_AMOUNT_MINOR, "That amount is too large");

export const monthInput = z.custom<Month>(isMonth, "Pick a month");

/** A rate as text → canonical "83.250000", or null for "" / null. */
const fxRate = z
  .string()
  .nullable()
  .transform((value, context) => {
    if (value === null || value.trim() === "") return null;
    const parsed = parseFxRate(value);
    if (!parsed.ok) {
      context.addIssue({ code: "custom", message: parsed.error });
      return z.NEVER;
    }
    return parsed.value;
  });

/** Collapsed-whitespace single line; "" → null when `optional`. */
function line(label: string, max: number) {
  return z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max, `${label} is too long`));
}

/** Notes: plain text, never a credential (same heuristic as the service registry). */
function notes(label: string, max: number) {
  return z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().max(max, `${label} are too long`))
    .superRefine((value, context) => {
      const found = findSecretInText(value);
      if (found) context.addIssue({ code: "custom", message: secretErrorMessage(label, found) });
    })
    .transform((value) => (value === "" ? null : value));
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Pick a real date");

export const costItemFields = z.object({
  name: line("Name", COST_NAME_MAX).pipe(z.string().min(1, "Enter a name")),
  vendor: line("Vendor", COST_VENDOR_MAX).transform((value) => (value === "" ? null : value)),
  category: z.enum(COST_CATEGORIES, "Pick a category"),
  billingCycle: z.enum(BILLING_CYCLES, "Pick a billing cycle"),
  currency: z.enum(COST_CURRENCIES, "Pick a currency"),
  expectedAmountMinor: amountMinor.nullable(),
  renewsOn: isoDate.nullable(),
  serviceId: id.nullable(),
  notes: notes("Notes", COST_NOTES_MAX),
});
export type CostItemFields = z.output<typeof costItemFields>;

export const createCostItemInput = costItemFields.extend({ projectKey });
export const updateCostItemInput = costItemFields.extend({ itemId: id });
export const costItemIdInput = z.object({ itemId: id });
export const setCostItemActiveInput = z.object({ itemId: id, active: z.boolean() });
export const moveCostItemInput = z.object({ itemId: id, index: z.number().int().min(0) });
export const addDefaultCostsInput = z.object({ projectKey });

export const setCostEntryInput = z
  .object({
    itemId: id,
    month: monthInput,
    amountMinor,
    currency: z.enum(COST_CURRENCIES),
    fxRate,
    kind: z.enum(COST_ENTRY_KINDS),
    notes: notes("Notes", COST_ENTRY_NOTES_MAX),
  })
  .refine((entry) => entry.kind !== "no_charge" || entry.amountMinor === 0, {
    message: "A “no charge” month has no amount",
    path: ["amountMinor"],
  });

export const clearCostEntryInput = z.object({ itemId: id, month: monthInput });
export const copyLastMonthInput = z.object({ projectKey, month: monthInput });

export const updateCostSettingsInput = z.object({
  projectKey,
  baseCurrency: z.enum(COST_CURRENCIES),
  monthlyBudgetMinor: amountMinor.nullable(),
  reminderDay: z
    .number()
    .int()
    .min(REMINDER_DAY_MIN, `Pick a day from ${REMINDER_DAY_MIN} to ${REMINDER_DAY_MAX}`)
    .max(REMINDER_DAY_MAX, `Pick a day from ${REMINDER_DAY_MIN} to ${REMINDER_DAY_MAX}`),
  reminderUserIds: z.array(id).max(50, "Too many recipients"),
  defaultUsdToInr: fxRate,
});
