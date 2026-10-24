import { escapeCsvCell } from "@/lib/imports/csv";

import { buildMonthView, buildYearGrid } from "./calc";
import {
  BILLING_CYCLE_LABELS,
  COST_CATEGORY_LABELS,
  COST_ENTRY_KIND_LABELS,
  type CostCurrency,
} from "./constants";
import { minorToDecimal } from "./money";
import { type Month, monthShortLabel } from "./month";
import { type CostEntryView, type CostItemView } from "./views";

/**
 * COST-5 CSV export (RFC 4180, CRLF). Every cell goes through `escapeCsvCell` (CSV
 * injection: item names and notes are user text). Amounts are plain decimals ("1234.50"),
 * so spreadsheets read them as numbers; the cash view (yearly items in their month).
 */

const line = (cells: (string | number | null)[]) => cells.map(escapeCsvCell).join(",");
const amount = (minor: number | null) => (minor === null ? "" : minorToDecimal(minor));

export function monthCsv(input: {
  items: readonly CostItemView[];
  entries: readonly CostEntryView[];
  month: Month;
  baseCurrency: CostCurrency;
}): string {
  const view = buildMonthView({ ...input, runRate: false, budgetMinor: null });
  const base = input.baseCurrency;
  const rows = [
    line([
      "Month",
      "Item",
      "Vendor",
      "Category",
      "Cycle",
      "Service",
      "Currency",
      "Amount",
      `Rate to ${base}`,
      `Amount (${base})`,
      "Kind",
      "Notes",
    ]),
    ...view.rows.map(({ item, entry }) =>
      line([
        input.month,
        item.name,
        item.vendor,
        COST_CATEGORY_LABELS[item.category],
        BILLING_CYCLE_LABELS[item.billingCycle],
        item.service?.name ?? null,
        entry?.currency ?? item.currency,
        amount(entry?.amountMinor ?? null),
        entry?.fxRate ?? null,
        amount(entry?.baseAmountMinor ?? null),
        entry ? COST_ENTRY_KIND_LABELS[entry.kind] : "Not entered",
        entry?.notes ?? null,
      ]),
    ),
    line([input.month, "Cash out", ...Array<null>(7).fill(null), amount(view.totals.cashOut)]),
    line([input.month, "IMR (yearly ÷ 12)", ...Array<null>(7).fill(null), amount(view.totals.imr)]),
  ];
  return `${rows.join("\r\n")}\r\n`;
}

export function yearCsv(input: {
  items: readonly CostItemView[];
  entries: readonly CostEntryView[];
  year: number;
  baseCurrency: CostCurrency;
  currentMonth: Month;
}): string {
  const grid = buildYearGrid({ ...input, runRate: false, monthLabel: monthShortLabel });
  const rows = [
    line([
      `Item (${input.baseCurrency})`,
      "Category",
      ...grid.months.map((month) => `${monthShortLabel(month)} ${input.year}`),
      "Total",
    ]),
    ...grid.rows.map((row) =>
      line([
        row.item.name,
        COST_CATEGORY_LABELS[row.item.category],
        ...row.cells.map(amount),
        amount(row.total),
      ]),
    ),
    line(["Total", null, ...grid.columnTotals.map(amount), amount(grid.yearTotal)]),
  ];
  return `${rows.join("\r\n")}\r\n`;
}
