import { COST_CATEGORIES, type CostCategory, type CostEntryKind } from "./constants";
import { amortiseYearly, percentChange } from "./money";
import { addMonths, type Month, monthNumber, monthsOfYear, yearOf } from "./month";
import { type CostEntryView, type CostItemView } from "./views";

/**
 * Pure cost maths for the Month and Year tabs and the export (COST-4/5). Every value is in
 * the base currency (`baseAmountMinor`), in minor units, summed as safe integers (see
 * `MAX_AMOUNT_MINOR`).
 *
 * - **Cash out** of a month: every entry of that month, yearly payments in full.
 * - **IMR** (run-rate) of a month: monthly and usage items' entries (actuals and
 *   estimates; "no charge" is 0) plus each yearly item's latest payment in the 12 months
 *   up to and including that month, divided by 12 (half-up). A yearly item without a
 *   payment in that window adds nothing: amounts are never guessed.
 */

export type EntryIndex = Map<string, CostEntryView>;

const key = (itemId: string, month: Month) => `${itemId}:${month}`;

export function indexEntries(entries: readonly CostEntryView[]): EntryIndex {
  return new Map(entries.map((entry) => [key(entry.itemId, entry.month), entry]));
}

export function entryFor(index: EntryIndex, itemId: string, month: Month) {
  return index.get(key(itemId, month)) ?? null;
}

/**
 * Whether an item is expected to have an entry in `month` (COST-7, the same rule as the
 * reminder's SQL in services/costs.ts): active, added by then, and monthly / usage, or
 * yearly with its renewal in that month.
 */
export function isExpectedInMonth(item: CostItemView, month: Month): boolean {
  if (!item.active || item.createdMonth > month) return false;
  if (item.billingCycle !== "yearly") return true;
  return item.renewsOn !== null && Number(item.renewsOn.slice(5, 7)) === monthNumber(month);
}

/** A yearly item's run-rate share in `month` (null without a payment in the window). */
export function yearlyRunRate(index: EntryIndex, itemId: string, month: Month): number | null {
  for (let back = 0; back < 12; back += 1) {
    const entry = entryFor(index, itemId, addMonths(month, -back));
    if (entry) return amortiseYearly(entry.baseAmountMinor);
  }
  return null;
}

/** What an item shows (and adds) in a month: its cash, or its run-rate share. */
export function itemValue(
  item: CostItemView,
  index: EntryIndex,
  month: Month,
  runRate: boolean,
): number | null {
  if (item.billingCycle === "yearly" && runRate) return yearlyRunRate(index, item.id, month);
  return entryFor(index, item.id, month)?.baseAmountMinor ?? null;
}

export interface MonthTotals {
  /** Run-rate (actuals + estimates, yearly amortised). */
  imr: number;
  /** Everything paid this month (yearly in full). */
  cashOut: number;
  /** Cash out split by kind. */
  actual: number;
  estimate: number;
  entries: number;
}

export function monthTotals(
  items: readonly CostItemView[],
  index: EntryIndex,
  month: Month,
): MonthTotals {
  const totals: MonthTotals = { imr: 0, cashOut: 0, actual: 0, estimate: 0, entries: 0 };
  for (const item of items) {
    const entry = entryFor(index, item.id, month);
    if (entry) {
      totals.cashOut += entry.baseAmountMinor;
      totals.entries += 1;
      if (entry.kind === "actual") totals.actual += entry.baseAmountMinor;
      if (entry.kind === "estimate") totals.estimate += entry.baseAmountMinor;
    }
    totals.imr += itemValue(item, index, month, true) ?? 0;
  }
  return totals;
}

export interface MonthRow {
  item: CostItemView;
  entry: CostEntryView | null;
  /** Shown value (cash, or run-rate share for a yearly item in run-rate mode). */
  value: number | null;
  previousValue: number | null;
  /** Percent vs last month, one decimal; null without both values. */
  change: number | null;
  /** Expected this month (see `isExpectedInMonth`). */
  due: boolean;
}

export interface BudgetStatus {
  budget: number;
  /** IMR / budget, e.g. 0.82; null for a zero budget. */
  ratio: number | null;
  over: boolean;
}

export interface MonthView {
  month: Month;
  rows: MonthRow[];
  totals: MonthTotals;
  previous: MonthTotals;
  /** IMR vs last month's IMR, percent. */
  imrChange: number | null;
  /** Expected items without an entry. */
  missing: CostItemView[];
  budget: BudgetStatus | null;
}

export function budgetStatus(imr: number, budget: number | null): BudgetStatus | null {
  if (budget === null) return null;
  return { budget, ratio: budget === 0 ? null : imr / budget, over: imr > budget };
}

/**
 * The Month tab: a row per active item, plus archived ones that have an entry this month
 * (they were still paid for), in list order.
 */
export function buildMonthView(input: {
  items: readonly CostItemView[];
  entries: readonly CostEntryView[];
  month: Month;
  runRate: boolean;
  budgetMinor: number | null;
}): MonthView {
  const { items, month, runRate } = input;
  const index = indexEntries(input.entries);
  const last = addMonths(month, -1);
  const rows = items
    .filter((item) => item.active || entryFor(index, item.id, month) !== null)
    .map((item): MonthRow => {
      const value = itemValue(item, index, month, runRate);
      const previousValue = itemValue(item, index, last, runRate);
      return {
        item,
        entry: entryFor(index, item.id, month),
        value,
        previousValue,
        change: value === null ? null : percentChange(value, previousValue),
        due: isExpectedInMonth(item, month),
      };
    });
  const totals = monthTotals(items, index, month);
  const previous = monthTotals(items, index, last);
  return {
    month,
    rows,
    totals,
    previous,
    imrChange: percentChange(totals.imr, previous.entries > 0 ? previous.imr : null),
    missing: items.filter(
      (item) => isExpectedInMonth(item, month) && entryFor(index, item.id, month) === null,
    ),
    budget: budgetStatus(totals.imr, input.budgetMinor),
  };
}

export interface YearRow {
  item: CostItemView;
  /** January … December. */
  cells: (number | null)[];
  total: number;
}

export type CategoryBar = { month: Month; label: string } & Record<CostCategory, number>;

export interface YearGrid {
  year: number;
  months: Month[];
  rows: YearRow[];
  columnTotals: number[];
  yearTotal: number;
  /** Mean monthly IMR over the year's months so far (all 12 for a past year). */
  averageImr: number | null;
  /** The month with the largest column total (null when nothing was entered). */
  highest: { month: Month; total: number } | null;
  /** Per month, the column total by category (the stacked chart and its table). */
  byCategory: CategoryBar[];
}

/**
 * The Year tab: items × months. Cells are cash (or, with `runRate`, yearly items spread
 * over the months). Rows: items with a value in the year, plus active ones.
 */
export function buildYearGrid(input: {
  items: readonly CostItemView[];
  entries: readonly CostEntryView[];
  year: number;
  runRate: boolean;
  /** "Now", to know how many months of the current year have passed. */
  currentMonth: Month;
  monthLabel: (month: Month) => string;
}): YearGrid {
  const { items, year, runRate } = input;
  const index = indexEntries(input.entries);
  const months = monthsOfYear(year);
  const rows = items
    .map((item): YearRow => {
      const cells = months.map((month) => itemValue(item, index, month, runRate));
      return { item, cells, total: cells.reduce<number>((sum, cell) => sum + (cell ?? 0), 0) };
    })
    .filter((row) => row.item.active || row.cells.some((cell) => cell !== null));
  const columnTotals = months.map((_, i) =>
    rows.reduce((sum, row) => sum + (row.cells[i] ?? 0), 0),
  );
  const yearTotal = columnTotals.reduce((sum, total) => sum + total, 0);

  const currentYear = yearOf(input.currentMonth);
  const elapsed =
    year < currentYear ? 12 : year > currentYear ? 0 : monthNumber(input.currentMonth);
  const imrs = months.slice(0, elapsed).map((month) => monthTotals(items, index, month).imr);
  const averageImr =
    imrs.length === 0 ? null : Math.round(imrs.reduce((sum, imr) => sum + imr, 0) / imrs.length);

  let highest: YearGrid["highest"] = null;
  for (const [i, month] of months.entries()) {
    const total = columnTotals[i] ?? 0;
    if (total > 0 && (highest === null || total > highest.total)) highest = { month, total };
  }

  const byCategory = months.map((month, i): CategoryBar => {
    const bar = Object.fromEntries(COST_CATEGORIES.map((category) => [category, 0])) as Record<
      CostCategory,
      number
    >;
    for (const row of rows) bar[row.item.category] += row.cells[i] ?? 0;
    return { month, label: input.monthLabel(month), ...bar };
  });

  return { year, months, rows, columnTotals, yearTotal, averageImr, highest, byCategory };
}

export interface CopiedEntry {
  itemId: string;
  amountMinor: number;
  currency: CostEntryView["currency"];
  fxRate: string | null;
  baseAmountMinor: number;
  kind: CostEntryKind;
}

/**
 * COST-5 "Copy last month": for every active monthly / usage item with no entry this month
 * but one last month, the same amount as an ESTIMATE (a "no charge" stays "no charge").
 * Yearly items are not copied: they are paid once a year.
 */
export function copyLastMonthPlan(
  items: readonly CostItemView[],
  entries: readonly CostEntryView[],
  month: Month,
): CopiedEntry[] {
  const index = indexEntries(entries);
  const last = addMonths(month, -1);
  return items.flatMap((item): CopiedEntry[] => {
    if (!item.active || item.billingCycle === "yearly") return [];
    if (entryFor(index, item.id, month)) return [];
    const previous = entryFor(index, item.id, last);
    if (!previous) return [];
    return [
      {
        itemId: item.id,
        amountMinor: previous.amountMinor,
        currency: previous.currency,
        fxRate: previous.fxRate,
        baseAmountMinor: previous.baseAmountMinor,
        kind: previous.kind === "no_charge" ? "no_charge" : "estimate",
      },
    ];
  });
}
