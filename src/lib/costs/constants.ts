/**
 * Costs (IMR, SPEC "Costs (IMR)" COST-1…COST-9) vocabulary. Isomorphic: shared by the
 * schema enums and CHECKs, the Zod schemas, the services and the UI.
 *
 * IMR = infrastructure monthly run-rate: what running Stockkart costs per month.
 */

/** `cost_items.category`. */
export const COST_CATEGORIES = [
  "hosting",
  "database",
  "storage",
  "email",
  "ai_ocr",
  "domain_dns",
  "monitoring",
  "source_control",
  "payments",
  "saas_other",
  "other",
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  hosting: "Hosting",
  database: "Database",
  storage: "Storage",
  email: "Email",
  ai_ocr: "AI / OCR",
  domain_dns: "Domain & DNS",
  monitoring: "Monitoring",
  source_control: "Source control",
  payments: "Payments",
  saas_other: "Other SaaS",
  other: "Other",
};

/**
 * `cost_items.billing_cycle`. `monthly` and `usage` items are expected every month;
 * `yearly` ones only in their renewal month (`renews_on`), and the run-rate spreads them
 * over 12 months (COST-4).
 */
export const BILLING_CYCLES = ["monthly", "yearly", "usage"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  usage: "Usage",
};

/** Money is in these currencies only (CHECK on every table). Both have 2 minor digits. */
export const COST_CURRENCIES = ["INR", "USD"] as const;
export type CostCurrency = (typeof COST_CURRENCIES)[number];

/** `cost_entries.kind`. `no_charge` is a month the item cost nothing (amount 0, CHECK). */
export const COST_ENTRY_KINDS = ["actual", "estimate", "no_charge"] as const;
export type CostEntryKind = (typeof COST_ENTRY_KINDS)[number];

export const COST_ENTRY_KIND_LABELS: Record<CostEntryKind, string> = {
  actual: "Actual",
  estimate: "Estimate",
  no_charge: "No charge",
};

/**
 * Largest amount in minor units (paise / cents) of one entry, expected amount or budget:
 * ₹ / $ 9,999,999,999.99. Kept far below `Number.MAX_SAFE_INTEGER` (≈ 9.007e15) so sums
 * stay exact JavaScript integers: `COST_ITEMS_MAX` items × 12 months × this ≈ 2.4e15.
 */
export const MAX_AMOUNT_MINOR = 999_999_999_999;
/** Live cost items per project (keeps every year sum a safe integer, see above). */
export const COST_ITEMS_MAX = 200;

/** `numeric(12,6)`: at most 6 integer and 6 fraction digits; always > 0. */
export const FX_RATE_SCALE = 6;
export const FX_RATE_INTEGER_DIGITS = 6;

export const COST_NAME_MAX = 100;
export const COST_VENDOR_MAX = 100;
export const COST_NOTES_MAX = 2000;
export const COST_ENTRY_NOTES_MAX = 500;

/** `cost_settings.reminder_day`: 1…28, so every month has that day. */
export const REMINDER_DAY_MIN = 1;
export const REMINDER_DAY_MAX = 28;
export const DEFAULT_REMINDER_DAY = 1;
export const DEFAULT_BASE_CURRENCY: CostCurrency = "INR";

/**
 * "Today" and "this month" for costs and the reminder are Stockkart's local calendar
 * (India), not the server's UTC: the 03:00 UTC cron is 08:30 here.
 */
export const COST_TIMEZONE = "Asia/Kolkata";

/** Tabs of /<KEY>/costs (`?tab=`). */
export const COST_TABS = ["month", "year", "items", "settings"] as const;
export type CostTab = (typeof COST_TABS)[number];
