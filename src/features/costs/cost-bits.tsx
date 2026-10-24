import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { type ReactNode } from "react";

import {
  BILLING_CYCLE_LABELS,
  type BillingCycle,
  COST_CATEGORY_LABELS,
  type CostCategory,
} from "@/lib/costs/constants";
import { cn } from "@/lib/utils";

/** Small shared pieces of the costs tabs. */

export function CategoryChip({ category }: { category: CostCategory }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs whitespace-nowrap text-muted-foreground">
      {COST_CATEGORY_LABELS[category]}
    </span>
  );
}

export function CycleLabel({ cycle }: { cycle: BillingCycle }) {
  return <span className="text-xs text-muted-foreground">{BILLING_CYCLE_LABELS[cycle]}</span>;
}

/** ↑ 12.5% / ↓ 3% / – (for costs, up is the bad direction, so it is amber). */
export function ChangeBadge({ change, label }: { change: number | null; label: string }) {
  if (change === null) {
    return (
      <span className="text-xs text-muted-foreground">
        <span aria-hidden="true">–</span>
        <span className="sr-only">{label}: no comparison</span>
      </span>
    );
  }
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  const words = change > 0 ? "up" : change < 0 ? "down" : "unchanged";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs whitespace-nowrap tabular-nums",
        change > 0 && "text-amber-700 dark:text-amber-400",
        change < 0 && "text-emerald-700 dark:text-emerald-400",
        change === 0 && "text-muted-foreground",
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      <span aria-hidden="true">{Math.abs(change)}%</span>
      <span className="sr-only">
        {label}: {words}
        {change === 0 ? "" : ` ${Math.abs(change)} percent`}
      </span>
    </span>
  );
}

export function StatCard({
  label,
  value,
  detail,
  children,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
      {children}
    </div>
  );
}

/** COST-4 budget bar: amber once the IMR is over the budget. */
export function BudgetBar({ ratio, over, label }: { ratio: number; over: boolean; label: string }) {
  const percent = Math.round(ratio * 100);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(percent, 100)}
      aria-valuetext={`${percent}% of the budget${over ? ", over budget" : ""}`}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          "h-full rounded-full",
          over ? "bg-amber-700 dark:bg-amber-400" : "bg-primary",
        )}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  );
}
