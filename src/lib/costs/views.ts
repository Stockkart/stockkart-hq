import {
  type BillingCycle,
  type CostCategory,
  type CostCurrency,
  type CostEntryKind,
} from "./constants";
import { type Month } from "./month";

/** Read models of /<KEY>/costs (COST-1…COST-9). Amounts are minor units (see money.ts). */

export interface CostItemView {
  id: string;
  name: string;
  vendor: string | null;
  category: CostCategory;
  billingCycle: BillingCycle;
  currency: CostCurrency;
  expectedAmountMinor: number | null;
  /** "YYYY-MM-DD"; a yearly item is due in this date's month every year. */
  renewsOn: string | null;
  notes: string | null;
  active: boolean;
  position: string;
  /** The linked service-registry entry (live ones only). */
  service: { id: string; name: string; slug: string } | null;
  /** The month the item was added (Stockkart time): it is not "missing" before that. */
  createdMonth: Month;
}

export interface CostEntryView {
  id: string;
  itemId: string;
  month: Month;
  amountMinor: number;
  currency: CostCurrency;
  /** `amount × rate = base amount`; null when the entry is in the base currency. */
  fxRate: string | null;
  baseAmountMinor: number;
  kind: CostEntryKind;
  notes: string | null;
  enteredByName: string | null;
}

export interface CostSettingsView {
  baseCurrency: CostCurrency;
  monthlyBudgetMinor: number | null;
  reminderDay: number;
  /** As stored; empty means "the project lead" (COST-7). */
  reminderUserIds: string[];
  /** "1 USD = x INR", e.g. "83.250000"; pre-fills new entries' rates. */
  defaultUsdToInr: string | null;
  /** False while the project still uses the defaults (no row yet). */
  saved: boolean;
  /** The project lead: the recipient while `reminderUserIds` is empty. */
  leadId: string | null;
  /** Any entry recorded: the base currency is then fixed. */
  hasEntries: boolean;
}

/** COST-7: a month whose costs are not complete, for a recipient (My Work) or the page. */
export interface CostReminder {
  projectKey: string;
  month: Month;
  missingCount: number;
}

export interface CostServiceOption {
  id: string;
  name: string;
  slug: string;
}

export interface CostUserOption {
  id: string;
  name: string;
  email: string;
}
