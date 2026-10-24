"use server";

import { type ActionResult } from "@/lib/action-result";
import {
  addDefaultCostsInput,
  clearCostEntryInput,
  copyLastMonthInput,
  costItemIdInput,
  createCostItemInput,
  moveCostItemInput,
  setCostEntryInput,
  setCostItemActiveInput,
  updateCostItemInput,
  updateCostSettingsInput,
} from "@/lib/costs/schemas";
import { requireSession } from "@/server/auth/require-session";
import { costService } from "@/server/services";

import { runAction } from "./action-runner";
import { COSTS, MY_WORK, refreshPages } from "./refresh";

/**
 * Costs actions (COST-1…COST-8). Each re-checks the session first (S-2: action ids can be
 * POSTed from anywhere), then validates its untrusted input with Zod, then calls the
 * service. Expected failures come back as `{ ok: false, error }`; a missing session throws.
 * Nothing here logs amounts (COST-9).
 */

/** Costs pages, plus My Work, whose COST-7 card counts the missing entries. */
const costs = () => refreshPages(COSTS, MY_WORK);

export async function createCostItemAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  return runAction(
    createCostItemInput,
    input,
    (data) => costService.createItem(session.user.id, data),
    costs,
  );
}

export async function updateCostItemAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  return runAction(
    updateCostItemInput,
    input,
    (data) => costService.updateItem(session.user.id, data),
    costs,
  );
}

export async function setCostItemActiveAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    setCostItemActiveInput,
    input,
    async (data) => {
      await costService.setActive(session.user.id, data.itemId, data.active);
      return undefined;
    },
    costs,
  );
}

export async function deleteCostItemAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    costItemIdInput,
    input,
    async (data) => {
      await costService.deleteItem(session.user.id, data.itemId);
      return undefined;
    },
    costs,
  );
}

export async function moveCostItemAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    moveCostItemInput,
    input,
    async (data) => {
      await costService.moveItem(session.user.id, data);
      return undefined;
    },
    () => refreshPages(COSTS),
  );
}

/** "Add Stockkart defaults" (idempotent by name). */
export async function addDefaultCostsAction(
  input: unknown,
): Promise<ActionResult<{ created: string[] }>> {
  const session = await requireSession();
  return runAction(
    addDefaultCostsInput,
    input,
    (data) => costService.addDefaults(session.user.id, data),
    costs,
  );
}

export async function setCostEntryAction(
  input: unknown,
): Promise<ActionResult<{ id: string; baseAmountMinor: number; fxRate: string | null }>> {
  const session = await requireSession();
  return runAction(
    setCostEntryInput,
    input,
    (data) => costService.setEntry(session.user.id, data),
    costs,
  );
}

export async function clearCostEntryAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    clearCostEntryInput,
    input,
    async (data) => {
      await costService.clearEntry(session.user.id, data);
      return undefined;
    },
    costs,
  );
}

export async function copyLastMonthAction(
  input: unknown,
): Promise<ActionResult<{ copied: number }>> {
  const session = await requireSession();
  return runAction(
    copyLastMonthInput,
    input,
    (data) => costService.copyLastMonth(session.user.id, data),
    costs,
  );
}

export async function updateCostSettingsAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    updateCostSettingsInput,
    input,
    async (data) => {
      await costService.updateSettings(session.user.id, data);
      return undefined;
    },
    costs,
  );
}
