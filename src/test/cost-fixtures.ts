import { type CostEntryKind } from "@/lib/costs/constants";
import { type Month } from "@/lib/costs/month";
import { type CostEntryView, type CostItemView } from "@/lib/costs/views";

/** Fake cost items and entries for the pure tests (no real data). */

let counter = 0;

export function fakeItem(patch: Partial<CostItemView> = {}): CostItemView {
  counter += 1;
  return {
    id: `item-${counter}`,
    name: `Item ${counter}`,
    vendor: null,
    category: "hosting",
    billingCycle: "monthly",
    currency: "INR",
    expectedAmountMinor: null,
    renewsOn: null,
    notes: null,
    active: true,
    position: `a${counter}`,
    service: null,
    createdMonth: "2020-01",
    ...patch,
  };
}

export function fakeEntry(
  item: CostItemView,
  month: Month,
  baseAmountMinor: number,
  kind: CostEntryKind = "actual",
  patch: Partial<CostEntryView> = {},
): CostEntryView {
  counter += 1;
  return {
    id: `entry-${counter}`,
    itemId: item.id,
    month,
    amountMinor: baseAmountMinor,
    currency: "INR",
    fxRate: null,
    baseAmountMinor,
    kind,
    notes: null,
    enteredByName: null,
    ...patch,
  };
}
