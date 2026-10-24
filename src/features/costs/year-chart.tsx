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

/**
 * One colour per category: `--chart-cost-*` tokens (globals.css), so each theme gets values
 * with at least 3:1 against its background and the bars switch without a re-render.
 */
const COLORS: Record<CostCategory, string> = {
  hosting: "var(--chart-cost-hosting)",
  database: "var(--chart-cost-database)",
  storage: "var(--chart-cost-storage)",
  email: "var(--chart-cost-email)",
  ai_ocr: "var(--chart-cost-ai-ocr)",
  domain_dns: "var(--chart-cost-domain-dns)",
  monitoring: "var(--chart-cost-monitoring)",
  source_control: "var(--chart-cost-source-control)",
  payments: "var(--chart-cost-payments)",
  saas_other: "var(--chart-cost-saas-other)",
  other: "var(--chart-cost-other)",
};

// Recharts draws tick text with `fill` (it defaults to the axis line colour, --border).
const AXIS = { fill: "var(--muted-foreground)", fontSize: 12 };

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
          // Recharts colours each row with its series colour; text uses the text token instead.
          itemStyle={{ color: "var(--popover-foreground)" }}
          cursor={{ fill: "var(--muted)" }}
          formatter={(value) =>
            typeof value === "number" ? formatMoney(value, currency) : String(value)
          }
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }}
          // Series colours are tuned for marks (3:1), not text: labels use the text token.
          labelStyle={{ color: "var(--foreground)" }}
        />
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
