"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { type CategoryBar } from "@/lib/costs/calc";
import { COST_CATEGORY_LABELS, type CostCategory, type CostCurrency } from "@/lib/costs/constants";
import { formatMoney, formatMoneyCompact } from "@/lib/costs/money";

/**
 * COST-5 stacked bar chart of a year by category (Recharts, MIT). Loaded only in the
 * browser, through `lazy-year-chart.tsx`. Decorative for assistive technology: the Year tab
 * renders the same numbers as a table (`ChartFigure`).
 */

/** One colour per category; mid-lightness so they read on light and dark backgrounds. */
const COLORS: Record<CostCategory, string> = {
  hosting: "oklch(0.6 0.15 262)",
  database: "oklch(0.62 0.14 155)",
  storage: "oklch(0.7 0.14 70)",
  email: "oklch(0.62 0.17 20)",
  ai_ocr: "oklch(0.6 0.16 300)",
  domain_dns: "oklch(0.66 0.1 200)",
  monitoring: "oklch(0.68 0.15 110)",
  source_control: "oklch(0.55 0.02 260)",
  payments: "oklch(0.65 0.16 340)",
  saas_other: "oklch(0.72 0.1 40)",
  other: "oklch(0.7 0.02 90)",
};

const AXIS = { stroke: "var(--muted-foreground)", fontSize: 12 };

export function YearCategoryChart({
  bars,
  categories,
  currency,
}: {
  bars: CategoryBar[];
  /** The categories with any amount this year, in order. */
  categories: CostCategory[];
  currency: CostCurrency;
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={bars} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} stroke="var(--border)" />
        <YAxis
          tick={AXIS}
          stroke="var(--border)"
          tickFormatter={(value: number) => formatMoneyCompact(Math.max(0, value), currency)}
        />
        <Tooltip
          contentStyle={{
            background: "var(--popover)",
            color: "var(--popover-foreground)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 12,
          }}
          cursor={{ fill: "var(--muted)" }}
          formatter={(value) =>
            typeof value === "number" ? formatMoney(value, currency) : String(value)
          }
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }} />
        {categories.map((category) => (
          <Bar
            key={category}
            name={COST_CATEGORY_LABELS[category]}
            dataKey={category}
            stackId="costs"
            fill={COLORS[category]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
