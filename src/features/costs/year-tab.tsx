"use client";

import { ChevronLeft, ChevronRight, Download, Repeat } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ChartFigure } from "@/features/sprints/sprint-charts";
import { buildYearGrid } from "@/lib/costs/calc";
import { COST_CATEGORIES, COST_CATEGORY_LABELS } from "@/lib/costs/constants";
import { formatMoney } from "@/lib/costs/money";
import { type Month, monthLabel, monthShortLabel, yearOf } from "@/lib/costs/month";
import { costsExportHref, costsHref } from "@/lib/costs/route";
import { type CostEntryView, type CostItemView, type CostSettingsView } from "@/lib/costs/views";

import { CategoryChip, StatCard } from "./cost-bits";
import { LazyYearCategoryChart } from "./lazy-year-chart";

const cell = "px-2 py-1.5 text-right tabular-nums whitespace-nowrap";

/**
 * COST-5 Year tab: items × months with row and column totals, the year total, the average
 * IMR and the highest month; a stacked bar chart by category (with the same numbers as a
 * table for assistive technology); a year switcher. Each month cell links to that month.
 */
export function YearTab({
  projectKey,
  year,
  thisMonth,
  items,
  entries,
  settings,
  runRate,
  onRunRateChange,
  onYearChange,
}: {
  projectKey: string;
  year: number;
  thisMonth: Month;
  items: CostItemView[];
  entries: CostEntryView[];
  settings: CostSettingsView;
  runRate: boolean;
  onRunRateChange: (on: boolean) => void;
  onYearChange: (year: number) => void;
}) {
  const base = settings.baseCurrency;
  const money = (minor: number) => formatMoney(minor, base);
  const grid = buildYearGrid({
    items,
    entries,
    year,
    runRate,
    currentMonth: thisMonth,
    monthLabel: monthShortLabel,
  });
  const categories = COST_CATEGORIES.filter((category) =>
    grid.byCategory.some((bar) => bar[category] > 0),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Previous year (${year - 1})`}
            onClick={() => onYearChange(year - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <h2 className="min-w-20 text-center text-lg font-medium" aria-live="polite">
            {year}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Next year (${year + 1})`}
            onClick={() => onYearChange(year + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          {year !== yearOf(thisMonth) ? (
            <Button variant="link" size="sm" onClick={() => onYearChange(yearOf(thisMonth))}>
              This year
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={runRate}
            onClick={() => onRunRateChange(!runRate)}
          >
            <Repeat aria-hidden="true" />
            Show run-rate
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={costsExportHref(projectKey, { year })} download>
              <Download aria-hidden="true" />
              Export CSV
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={`${year} total`}
          value={money(grid.yearTotal)}
          detail={runRate ? "Yearly items spread ÷ 12" : "Cash out"}
        />
        <StatCard
          label="Average IMR"
          value={grid.averageImr === null ? "–" : money(grid.averageImr)}
          detail="Per month so far this year"
        />
        <StatCard
          label="Highest month"
          value={grid.highest ? money(grid.highest.total) : "–"}
          detail={grid.highest ? monthLabel(grid.highest.month) : "Nothing entered yet"}
        />
      </div>

      <ChartFigure
        title={`${year} by category`}
        summary={`Monthly ${runRate ? "run-rate" : "cash out"} in ${base}, stacked by category`}
        chart={
          <LazyYearCategoryChart bars={grid.byCategory} categories={categories} currency={base} />
        }
        table={
          <table className="w-full text-xs">
            <caption className="sr-only">
              {year} costs by category and month, in {base}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="border-b px-2 py-1 text-left font-medium">
                  Category
                </th>
                {grid.byCategory.map((bar) => (
                  <th key={bar.month} scope="col" className={`border-b font-medium ${cell}`}>
                    {bar.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category}>
                  <th scope="row" className="border-b px-2 py-1 text-left font-normal">
                    {COST_CATEGORY_LABELS[category]}
                  </th>
                  {grid.byCategory.map((bar) => (
                    <td key={bar.month} className={`border-b ${cell}`}>
                      {bar[category] > 0 ? money(bar[category]) : "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        }
      />

      {grid.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No costs in {year}.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[64rem] text-sm">
            <caption className="sr-only">
              {year} costs per item and month in {base}, with row and column totals
            </caption>
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th scope="col" className="sticky left-0 bg-background px-3 py-2 text-left">
                  Item
                </th>
                {grid.months.map((month) => (
                  <th key={month} scope="col" className={`font-medium ${cell}`}>
                    <Link href={costsHref(projectKey, { month })} className="hover:underline">
                      <span aria-hidden="true">{monthShortLabel(month)}</span>
                      <span className="sr-only">{monthLabel(month)}</span>
                    </Link>
                  </th>
                ))}
                <th scope="col" className={`font-medium ${cell}`}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.item.id} className="border-b last:border-b-0">
                  <th
                    scope="row"
                    className="sticky left-0 bg-background px-3 py-1.5 text-left font-normal"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{row.item.name}</span>
                      <CategoryChip category={row.item.category} />
                    </span>
                  </th>
                  {row.cells.map((value, i) => (
                    <td key={grid.months[i]} className={cell}>
                      {value === null ? (
                        <span className="text-muted-foreground">–</span>
                      ) : (
                        money(value)
                      )}
                    </td>
                  ))}
                  <td className={`font-medium ${cell}`}>{money(row.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-medium">
                <th scope="row" className="sticky left-0 bg-background px-3 py-2 text-left">
                  Total
                </th>
                {grid.columnTotals.map((total, i) => (
                  <td key={grid.months[i]} className={cell}>
                    {money(total)}
                  </td>
                ))}
                <td className={cell}>{money(grid.yearTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
