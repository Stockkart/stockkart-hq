"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelect, Select } from "@/components/ui/select";
import { callAction } from "@/features/issue/client-utils";
import {
  COST_CURRENCIES,
  type CostCurrency,
  REMINDER_DAY_MAX,
  REMINDER_DAY_MIN,
} from "@/lib/costs/constants";
import { formatRate } from "@/lib/costs/money";
import { updateCostSettingsInput } from "@/lib/costs/schemas";
import { type CostSettingsView, type CostUserOption } from "@/lib/costs/views";
import { updateCostSettingsAction } from "@/server/actions/costs";

import { MoneyInput } from "./money-input";

const DAYS = Array.from({ length: REMINDER_DAY_MAX - REMINDER_DAY_MIN + 1 }, (_, i) => {
  const day = REMINDER_DAY_MIN + i;
  return { value: day, label: String(day) };
});

/**
 * COST-8 Settings: base currency (fixed once entries exist), monthly budget, the reminder
 * day and its recipients (default: the project lead), and the default USD → INR rate that
 * pre-fills new entries (stored per entry and editable there; never fetched from the
 * internet).
 */
export function SettingsTab({
  projectKey,
  settings,
  users,
}: {
  projectKey: string;
  settings: CostSettingsView;
  users: CostUserOption[];
}) {
  const router = useRouter();
  const [baseCurrency, setBaseCurrency] = useState<CostCurrency>(settings.baseCurrency);
  const [budget, setBudget] = useState<number | null>(settings.monthlyBudgetMinor);
  const [reminderDay, setReminderDay] = useState(settings.reminderDay);
  // Empty means "the project lead" (COST-7): show who that is, so saving keeps it explicit.
  const [recipients, setRecipients] = useState<string[]>(
    settings.reminderUserIds.length > 0
      ? settings.reminderUserIds
      : settings.leadId
        ? [settings.leadId]
        : [],
  );
  const [rate, setRate] = useState(
    settings.defaultUsdToInr ? formatRate(settings.defaultUsdToInr) : "",
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const base = useId();
  const id = (field: string) => `${base}-${field}`;

  function submit() {
    const input = {
      projectKey,
      baseCurrency,
      monthlyBudgetMinor: budget,
      reminderDay,
      reminderUserIds: recipients,
      defaultUsdToInr: rate,
    };
    const parsed = updateCostSettingsInput.safeParse(input);
    if (!parsed.success) {
      setErrors([...new Set(parsed.error.issues.map((issue) => issue.message))]);
      return;
    }
    setErrors([]);
    startTransition(async () => {
      const result = await callAction(() => updateCostSettingsAction(input));
      if (result === null) return;
      toast.success("Costs settings saved");
      router.refresh();
    });
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-5"
      aria-describedby={errors.length > 0 ? id("errors") : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div aria-live="assertive" id={id("errors")}>
        {errors.length > 0 ? (
          <ul className="list-disc rounded-md border border-destructive/40 bg-destructive/5 py-2 pr-3 pl-7 text-sm text-destructive">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={id("base")} className="text-sm font-medium">
          Base currency
        </label>
        <Select
          id={id("base")}
          label="Base currency"
          className="w-40"
          value={baseCurrency}
          disabled={settings.hasEntries}
          aria-describedby={id("base-hint")}
          options={COST_CURRENCIES.map((value) => ({ value, label: value }))}
          onChange={(value) => value && setBaseCurrency(value)}
        />
        <span id={id("base-hint")} className="text-xs text-muted-foreground">
          {settings.hasEntries
            ? "Fixed once costs are entered (their converted amounts are in this currency)."
            : "Totals, budget and charts are in this currency."}
        </span>
      </div>
      <MoneyInput
        className="w-56"
        label="Monthly budget (IMR)"
        currency={baseCurrency}
        value={budget}
        placeholder="No budget"
        onCommit={setBudget}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={id("day")} className="text-sm font-medium">
          Reminder day
        </label>
        <Select
          id={id("day")}
          label="Reminder day"
          className="w-24"
          value={reminderDay}
          options={DAYS}
          searchable={false}
          aria-describedby={id("day-hint")}
          onChange={(value) => value && setReminderDay(value)}
        />
        <span id={id("day-hint")} className="text-xs text-muted-foreground">
          From this day of each month, the recipients get a bell reminder if last month&apos;s costs
          are not all entered (in the bell; no email).
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={id("recipients")} className="text-sm font-medium">
          Reminder recipients
        </label>
        <MultiSelect
          id={id("recipients")}
          label="Reminder recipients"
          value={recipients}
          placeholder="The project lead"
          options={users.map((user) => ({
            value: user.id,
            label: user.name,
            keywords: user.email,
            detail: user.id === settings.leadId ? "Lead" : undefined,
          }))}
          onChange={setRecipients}
        />
        <span className="text-xs text-muted-foreground">
          Nobody picked: the project lead gets it.
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={id("rate")} className="text-sm font-medium">
          Default rate: 1 USD in INR
        </label>
        <Input
          id={id("rate")}
          className="w-40 tabular-nums"
          inputMode="decimal"
          value={rate}
          placeholder="e.g. 83.25"
          aria-describedby={id("rate-hint")}
          onChange={(event) => setRate(event.target.value)}
        />
        <span id={id("rate-hint")} className="text-xs text-muted-foreground">
          Pre-fills the rate of new entries in the other currency. Each entry keeps its own rate,
          editable on the Month tab. HQ never looks rates up online.
        </span>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
