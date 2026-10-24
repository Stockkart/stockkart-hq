"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { type BurndownPoint, type VelocityBar } from "@/lib/sprints/views";

/**
 * SPR-3/SPR-4 charts (Recharts, MIT). Loaded only in the browser, through `lazy-charts.tsx`.
 * Colours are CSS variables (globals.css), so they follow the light/dark theme without a
 * re-render. The SVG is decorative for assistive technology: `ChartFigure` renders the same
 * numbers as a table.
 */

// Recharts draws tick text with `fill` (it defaults to the axis line colour, --border).
const AXIS = { fill: "var(--muted-foreground)", fontSize: 12 };
const TOOLTIP = {
  contentStyle: {
    background: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    fontSize: 12,
  },
  labelStyle: { color: "var(--popover-foreground)" },
  // Recharts colours each row with its series colour; text uses the text token instead.
  itemStyle: { color: "var(--popover-foreground)" },
};

export function BurndownChart({ points }: { points: BurndownPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={AXIS} stroke="var(--border)" />
        <YAxis allowDecimals={false} tick={AXIS} stroke="var(--border)" />
        <Tooltip {...TOOLTIP} />
        <Legend
          wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }}
          // Series colours are tuned for marks (3:1), not text: labels use the text token.
          labelStyle={{ color: "var(--foreground)" }}
        />
        <Line
          name="Ideal"
          dataKey="ideal"
          stroke="var(--chart-ideal)"
          strokeDasharray="6 4"
          dot={false}
          isAnimationActive={false}
        />
        <Line
          name="Scope"
          type="stepAfter"
          dataKey="scope"
          stroke="var(--chart-scope)"
          dot={false}
          isAnimationActive={false}
        />
        <Line
          name="Remaining"
          dataKey="remaining"
          stroke="var(--chart-remaining)"
          strokeWidth={2}
          dot={{ r: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function VelocityChart({ bars }: { bars: VelocityBar[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={bars} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tick={AXIS} stroke="var(--border)" />
        <YAxis allowDecimals={false} tick={AXIS} stroke="var(--border)" />
        <Tooltip {...TOOLTIP} cursor={{ fill: "var(--muted)" }} />
        <Bar
          name="Completed points"
          dataKey="completed"
          fill="var(--chart-completed)"
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
