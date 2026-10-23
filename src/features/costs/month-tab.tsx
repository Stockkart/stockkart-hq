"use client";

import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  MoreHorizontal,
  Repeat,
  Server,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { callAction } from "@/features/issue/client-utils";
import { buildMonthView, type MonthRow } from "@/lib/costs/calc";
import {
  COST_ENTRY_KIND_LABELS,
  COST_ENTRY_KINDS,
  COST_ENTRY_NOTES_MAX,
  type CostCurrency,
  type CostEntryKind,
} from "@/lib/costs/constants";
import {
  convertToBase,
  defaultRate,
  formatMoney,
  formatRate,
  parseFxRate,
} from "@/lib/costs/money";
import { addMonths, type Month, monthLabel, monthName } from "@/lib/costs/month";
import { costsExportHref } from "@/lib/costs/route";
import {
  type CostEntryView,
  type CostItemView,
  type CostReminder,
  type CostSettingsView,
} from "@/lib/costs/views";
import { servicePath } from "@/lib/service-registry/slug";
import { cn } from "@/lib/utils";
import {
  clearCostEntryAction,
  copyLastMonthAction,
  setCostEntryAction,
} from "@/server/actions/costs";

import { BudgetBar, CategoryChip, ChangeBadge, CycleLabel, StatCard } from "./cost-bits";
import { MoneyInput } from "./money-input";

interface EntryPatch {
  amountMinor: number;
  kind: CostEntryKind;
  notes: string | null;
  fxRate: string | null;
}

/** The currency a row's amount is in: the saved entry's, else (new / no charge) the item's. */
function entryCurrency(item: CostItemView, entry: CostEntryView | null): CostCurrency {
  return entry && entry.kind !== "no_charge" ? entry.currency : item.currency;
}

/**
 * COST-4/5 Month tab: one row per active item with this month's amount (inline money
 * input), kind, notes and the change vs last month; "Copy last month", "Mark no charge";
 * the IMR, cash out, budget and last-month comparisons. Edits show at once and roll back if
 * the server refuses (optimistic).
 */
export function MonthTab({
  projectKey,
  month,
  thisMonth,
  items,
  entries: serverEntries,
  settings,
  reminder,
  runRate,
  onRunRateChange,
  onMonthChange,
}: {
  projectKey: string;
  month: Month;
  thisMonth: Month;
  items: CostItemView[];
  entries: CostEntryView[];
  settings: CostSettingsView;
  reminder: CostReminder | null;
  runRate: boolean;
  onRunRateChange: (on: boolean) => void;
  onMonthChange: (month: Month) => void;
}) {
  const [entries, setEntries] = useState(serverEntries);
  const [seen, setSeen] = useState(serverEntries);
  if (seen !== serverEntries) {
    // The server re-rendered: its entries are the truth.
    setSeen(serverEntries);
    setEntries(serverEntries);
  }
  const [announcement, setAnnouncement] = useState("");
  const [copying, startCopy] = useTransition();
  const [, startSave] = useTransition();
  const base = settings.baseCurrency;
  const view = buildMonthView({
    items,
    entries,
    month,
    runRate,
    budgetMinor: settings.monthlyBudgetMinor,
  });
  const money = (minor: number) => formatMoney(minor, base);
  const isReminderMonth = reminder?.month === month;

  function replaceEntry(itemId: string, next: CostEntryView | null) {
    setEntries((current) => [
      ...current.filter((entry) => !(entry.itemId === itemId && entry.month === month)),
      ...(next ? [next] : []),
    ]);
  }

  function save(item: CostItemView, patch: EntryPatch) {
    const existing = entries.find((entry) => entry.itemId === item.id && entry.month === month);
    const noCharge = patch.kind === "no_charge";
    // A saved entry keeps its own currency (the item's may have changed since); only a new
    // entry, or one that was "no charge" (stored in the base), takes the item's.
    const currency: CostCurrency = noCharge ? base : entryCurrency(item, existing ?? null);
    const amountMinor = noCharge ? 0 : patch.amountMinor;
    const fxRate = currency === base ? null : patch.fxRate;
    if (currency !== base && !fxRate) {
      toast.error(`Enter the ${currency} → ${base} rate for ${item.name} first`);
      return;
    }
    const baseAmount = fxRate ? convertToBase(amountMinor, fxRate) : amountMinor;
    if (baseAmount === null) {
      toast.error("That amount is too large");
      return;
    }
    replaceEntry(item.id, {
      id: existing?.id ?? `pending-${item.id}`,
      itemId: item.id,
      month,
      amountMinor,
      currency,
      fxRate,
      baseAmountMinor: baseAmount,
      kind: patch.kind,
      notes: patch.notes,
      enteredByName: existing?.enteredByName ?? null,
    });
    startSave(async () => {
      const result = await callAction(() =>
        setCostEntryAction({
          itemId: item.id,
          month,
          amountMinor,
          currency,
          fxRate,
          kind: patch.kind,
          notes: patch.notes ?? "",
        }),
      );
      if (result === null) {
        // Roll back this row only: other rows may have edits in flight.
        replaceEntry(item.id, existing ?? null);
        setAnnouncement(`${item.name} could not be saved`);
      } else {
        setAnnouncement(`Saved ${item.name} for ${monthLabel(month)}`);
      }
    });
  }

  function clear(item: CostItemView) {
    const existing = entries.find((entry) => entry.itemId === item.id && entry.month === month);
    replaceEntry(item.id, null);
    startSave(async () => {
      const result = await callAction(() => clearCostEntryAction({ itemId: item.id, month }));
      if (result === null) replaceEntry(item.id, existing ?? null);
      else setAnnouncement(`Cleared ${item.name} for ${monthLabel(month)}`);
    });
  }

  function copyLastMonth() {
    startCopy(async () => {
      const result = await callAction(() => copyLastMonthAction({ projectKey, month }));
      if (!result) return;
      toast.success(
        result.copied > 0
          ? `Copied ${result.copied} ${result.copied === 1 ? "item" : "items"} from ${monthName(addMonths(month, -1))} as estimates`
          : `Nothing to copy from ${monthName(addMonths(month, -1))}`,
      );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Previous month (${monthLabel(addMonths(month, -1))})`}
            onClick={() => onMonthChange(addMonths(month, -1))}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <h2 className="min-w-40 text-center text-lg font-medium" aria-live="polite">
            {monthLabel(month)}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Next month (${monthLabel(addMonths(month, 1))})`}
            onClick={() => onMonthChange(addMonths(month, 1))}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          {month !== thisMonth ? (
            <Button variant="link" size="sm" onClick={() => onMonthChange(thisMonth)}>
              This month
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
          <Button variant="outline" size="sm" disabled={copying} onClick={copyLastMonth}>
            <Copy aria-hidden="true" />
            Copy last month
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={costsExportHref(projectKey, { month })} download>
              <Download aria-hidden="true" />
              Export CSV
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="IMR this month"
          value={money(view.totals.imr)}
          detail={
            <span className="inline-flex flex-wrap items-center gap-1">
              Actuals + estimates, yearly ÷ 12 · vs last month {money(view.previous.imr)}
              <ChangeBadge change={view.imrChange} label="IMR vs last month" />
            </span>
          }
        />
        <StatCard
          label="Cash out this month"
          value={money(view.totals.cashOut)}
          detail={`Actual ${money(view.totals.actual)} · estimate ${money(view.totals.estimate)}`}
        />
        <StatCard
          label="Budget"
          value={view.budget ? money(view.budget.budget) : "Not set"}
          detail={
            view.budget
              ? view.budget.over
                ? `Over by ${money(view.totals.imr - view.budget.budget)}`
                : `${money(view.budget.budget - view.totals.imr)} left`
              : "Set a monthly budget in Settings"
          }
        >
          {view.budget && view.budget.ratio !== null ? (
            <BudgetBar
              ratio={view.budget.ratio}
              over={view.budget.over}
              label="IMR against the monthly budget"
            />
          ) : null}
        </StatCard>
      </div>

      {view.missing.length > 0 ? (
        <p
          className={cn(
            "text-sm",
            isReminderMonth ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground",
          )}
        >
          {view.missing.length === 1 ? "1 item has" : `${view.missing.length} items have`} no amount
          for {monthName(month)} yet: {view.missing.map((item) => item.name).join(", ")}.
        </p>
      ) : null}

      {view.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No cost items yet. Add them on the Items tab (or start with the Stockkart defaults).
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[60rem] text-sm">
            <caption className="sr-only">
              Costs for {monthLabel(month)}, amounts in each item&apos;s currency, totals in {base}
            </caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">
                  Item
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Category
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Expected
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  {monthName(month)}
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Kind
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Notes
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  In {base}
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  vs last month
                </th>
                <th scope="col" className="px-2 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <MonthRowView
                  key={row.item.id}
                  projectKey={projectKey}
                  row={row}
                  base={base}
                  usdToInr={settings.defaultUsdToInr}
                  runRate={runRate}
                  onSave={(patch) => save(row.item, patch)}
                  onClear={() => clear(row.item)}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-medium">
                <th scope="row" colSpan={6} className="px-3 py-2 text-left">
                  {runRate ? "IMR (run-rate)" : "Cash out"}
                </th>
                <td className="px-2 py-2 text-right tabular-nums">
                  {money(runRate ? view.totals.imr : view.totals.cashOut)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function MonthRowView({
  projectKey,
  row,
  base,
  usdToInr,
  runRate,
  onSave,
  onClear,
}: {
  projectKey: string;
  row: MonthRow;
  base: CostCurrency;
  usdToInr: string | null;
  runRate: boolean;
  onSave: (patch: EntryPatch) => void;
  onClear: () => void;
}) {
  const { item, entry } = row;
  const currency = entryCurrency(item, entry);
  const foreign = currency !== base && entry?.kind !== "no_charge";
  const savedRate = entry?.fxRate ?? defaultRate(currency, base, usdToInr) ?? "";
  const [rate, setRate] = useState(savedRate ? formatRate(savedRate) : "");
  const [rateError, setRateError] = useState<string | null>(null);
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [seenNotes, setSeenNotes] = useState(entry?.notes ?? "");
  if ((entry?.notes ?? "") !== seenNotes) {
    setSeenNotes(entry?.notes ?? "");
    setNotes(entry?.notes ?? "");
  }
  const yearlySpread = item.billingCycle === "yearly" && runRate;
  const notDue = !row.due && entry === null;

  function currentRate(): string | null {
    if (!foreign) return null;
    const parsed = parseFxRate(rate);
    if (!parsed.ok) {
      setRateError(parsed.error);
      return null;
    }
    setRateError(null);
    return parsed.value;
  }

  function saveAmount(minor: number | null) {
    if (minor === null) {
      if (entry) onClear();
      return;
    }
    const kind = entry && entry.kind !== "no_charge" ? entry.kind : "actual";
    onSave({ amountMinor: minor, kind, notes: entry?.notes ?? null, fxRate: currentRate() });
  }

  const rateId = `rate-${item.id}`;
  return (
    <tr className={cn("border-b align-top last:border-b-0", notDue && "text-muted-foreground")}>
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <span className="block font-medium text-foreground">{item.name}</span>
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {item.vendor ? <span>{item.vendor}</span> : null}
          <CycleLabel cycle={item.billingCycle} />
          {item.service ? (
            <Link
              href={servicePath(projectKey, item.service.slug)}
              className="inline-flex items-center gap-0.5 hover:underline"
            >
              <Server aria-hidden="true" className="size-3" />
              {item.service.name}
            </Link>
          ) : null}
          {!item.active ? <span>(archived)</span> : null}
          {notDue && item.renewsOn ? <span>Not due this month</span> : null}
        </span>
      </th>
      <td className="px-2 py-2">
        <CategoryChip category={item.category} />
      </td>
      <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums">
        {item.expectedAmountMinor !== null
          ? formatMoney(item.expectedAmountMinor, item.currency)
          : "–"}
      </td>
      <td className="px-2 py-2">
        <div className="flex w-44 flex-col gap-1">
          <MoneyInput
            label={`${item.name} amount`}
            labelHidden
            currency={entry?.kind === "no_charge" ? base : currency}
            value={entry?.amountMinor ?? null}
            disabled={entry?.kind === "no_charge"}
            onCommit={saveAmount}
          />
          {foreign ? (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <label htmlFor={rateId} className="whitespace-nowrap">
                1 {currency} =
              </label>
              <Input
                id={rateId}
                inputMode="decimal"
                value={rate}
                placeholder="rate"
                aria-invalid={rateError ? true : undefined}
                aria-describedby={rateError ? `${rateId}-error` : undefined}
                className="h-7 w-20 px-1.5 text-right text-xs tabular-nums"
                onChange={(event) => setRate(event.target.value)}
                onBlur={() => {
                  const next = currentRate();
                  if (next && entry && next !== entry.fxRate) {
                    onSave({
                      amountMinor: entry.amountMinor,
                      kind: entry.kind,
                      notes: entry.notes,
                      fxRate: next,
                    });
                  }
                }}
              />
              <span aria-hidden="true">{base}</span>
              <span id={`${rateId}-error`} aria-live="polite" className="text-destructive">
                {rateError}
              </span>
            </div>
          ) : null}
        </div>
      </td>
      <td className="px-2 py-2">
        <Select
          label={`${item.name} kind`}
          aria-label={`${item.name} kind`}
          className="h-8 w-32"
          disabled={!entry}
          value={entry?.kind ?? null}
          placeholder="Not entered"
          options={COST_ENTRY_KINDS.map((kind) => ({
            value: kind,
            label: COST_ENTRY_KIND_LABELS[kind],
          }))}
          onChange={(kind) => {
            if (!kind || !entry || kind === entry.kind) return;
            onSave({
              amountMinor: kind === "no_charge" ? 0 : entry.amountMinor,
              kind,
              notes: entry.notes,
              fxRate: kind === "no_charge" ? null : (entry.fxRate ?? currentRate()),
            });
          }}
        />
      </td>
      <td className="px-2 py-2">
        <label htmlFor={`notes-${item.id}`} className="sr-only">
          {item.name} notes
        </label>
        <Input
          id={`notes-${item.id}`}
          value={notes}
          maxLength={COST_ENTRY_NOTES_MAX}
          disabled={!entry}
          placeholder={entry ? "Add a note" : ""}
          className="h-8 w-40"
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => {
            if (!entry || notes.trim() === (entry.notes ?? "")) return;
            onSave({
              amountMinor: entry.amountMinor,
              kind: entry.kind,
              notes: notes.trim() === "" ? null : notes,
              fxRate: entry.fxRate,
            });
          }}
        />
      </td>
      <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">
        {row.value !== null ? formatMoney(row.value, base) : "–"}
        {yearlySpread && row.value !== null ? (
          <span className="block text-xs text-muted-foreground">÷ 12</span>
        ) : null}
      </td>
      <td className="px-2 py-2">
        <ChangeBadge change={row.change} label={`${item.name} vs last month`} />
      </td>
      <td className="px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${item.name}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={entry?.kind === "no_charge"}
              onSelect={() =>
                onSave({
                  amountMinor: 0,
                  kind: "no_charge",
                  notes: entry?.notes ?? null,
                  fxRate: null,
                })
              }
            >
              Mark no charge
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!entry} onSelect={onClear}>
              <Eraser aria-hidden="true" />
              Clear this month
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
