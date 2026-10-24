"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { callAction } from "@/features/issue/client-utils";
import {
  BILLING_CYCLE_LABELS,
  BILLING_CYCLES,
  type BillingCycle,
  COST_CATEGORIES,
  COST_CATEGORY_LABELS,
  COST_CURRENCIES,
  COST_NAME_MAX,
  COST_NOTES_MAX,
  COST_VENDOR_MAX,
  type CostCategory,
  type CostCurrency,
} from "@/lib/costs/constants";
import { costItemFields } from "@/lib/costs/schemas";
import { type CostItemView, type CostServiceOption } from "@/lib/costs/views";
import { createCostItemAction, updateCostItemAction } from "@/server/actions/costs";

import { MoneyInput } from "./money-input";

const textareaClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive";

/**
 * COST-1 create / edit a cost item: name, vendor, category, billing cycle, currency,
 * expected amount, renewal date (yearly items are due in its month), linked service,
 * notes. Validated with the server's Zod schema before sending; the server's answer counts.
 */
export function CostItemFormDialog({
  projectKey,
  services,
  item,
  onOpenChange,
}: {
  projectKey: string;
  services: CostServiceOption[];
  /** Absent: a new item. */
  item?: CostItemView;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(item?.name ?? "");
  const [vendor, setVendor] = useState(item?.vendor ?? "");
  const [category, setCategory] = useState<CostCategory>(item?.category ?? "hosting");
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(item?.billingCycle ?? "monthly");
  const [currency, setCurrency] = useState<CostCurrency>(item?.currency ?? "USD");
  const [expected, setExpected] = useState<number | null>(item?.expectedAmountMinor ?? null);
  const [renewsOn, setRenewsOn] = useState(item?.renewsOn ?? "");
  const [serviceId, setServiceId] = useState<string | null>(item?.service?.id ?? null);
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const base = useId();
  const id = (field: string) => `${base}-${field}`;

  function submit() {
    const fields = {
      name,
      vendor,
      category,
      billingCycle,
      currency,
      expectedAmountMinor: expected,
      renewsOn: renewsOn === "" ? null : renewsOn,
      serviceId,
      notes,
    };
    const parsed = costItemFields.safeParse(fields);
    if (!parsed.success) {
      setErrors([...new Set(parsed.error.issues.map((issue) => issue.message))]);
      return;
    }
    setErrors([]);
    startTransition(async () => {
      const saved = await callAction(() =>
        item
          ? updateCostItemAction({ itemId: item.id, ...fields })
          : createCostItemAction({ projectKey, ...fields }),
      );
      if (!saved) return;
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item ? `Edit ${item.name}` : "New cost item"}</DialogTitle>
          <DialogDescription>
            Something Stockkart pays for. Enter each month&apos;s amount on the Month tab.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor={id("name")}>
              <Input
                id={id("name")}
                autoFocus
                value={name}
                maxLength={COST_NAME_MAX}
                aria-required="true"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Vendor" htmlFor={id("vendor")}>
              <Input
                id={id("vendor")}
                value={vendor}
                maxLength={COST_VENDOR_MAX}
                onChange={(event) => setVendor(event.target.value)}
              />
            </Field>
            <Field label="Category" htmlFor={id("category")}>
              <Select
                id={id("category")}
                label="Category"
                value={category}
                options={COST_CATEGORIES.map((value) => ({
                  value,
                  label: COST_CATEGORY_LABELS[value],
                }))}
                onChange={(value) => value && setCategory(value)}
              />
            </Field>
            <Field label="Billing cycle" htmlFor={id("cycle")}>
              <Select
                id={id("cycle")}
                label="Billing cycle"
                value={billingCycle}
                options={BILLING_CYCLES.map((value) => ({
                  value,
                  label: BILLING_CYCLE_LABELS[value],
                }))}
                onChange={(value) => value && setBillingCycle(value)}
              />
            </Field>
            <Field label="Currency" htmlFor={id("currency")}>
              <Select
                id={id("currency")}
                label="Currency"
                value={currency}
                options={COST_CURRENCIES.map((value) => ({ value, label: value }))}
                onChange={(value) => value && setCurrency(value)}
              />
            </Field>
            <MoneyInput
              label="Expected per cycle (optional)"
              currency={currency}
              value={expected}
              onCommit={setExpected}
            />
            <Field
              label="Renews on"
              htmlFor={id("renews")}
              hint={
                billingCycle === "yearly"
                  ? "A yearly item is due in this month every year."
                  : "Optional."
              }
            >
              <Input
                id={id("renews")}
                type="date"
                value={renewsOn}
                onChange={(event) => setRenewsOn(event.target.value)}
              />
            </Field>
            <Field label="Linked service" htmlFor={id("service")}>
              <Select
                id={id("service")}
                label="Linked service"
                value={serviceId}
                clearLabel="None"
                options={services.map((service) => ({
                  value: service.id,
                  label: service.name,
                  keywords: service.slug,
                }))}
                onChange={setServiceId}
              />
            </Field>
          </div>
          <Field label="Notes" htmlFor={id("notes")} hint="Plan, account, who pays. No passwords.">
            <textarea
              id={id("notes")}
              className={textareaClass}
              rows={3}
              value={notes}
              maxLength={COST_NOTES_MAX}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {item ? "Save" : "Add item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
