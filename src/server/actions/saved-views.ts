"use server";

import { type z } from "zod";

import { type ActionResult } from "@/lib/action-result";
import {
  moveViewInput,
  renameViewInput,
  saveViewInput,
  setViewSharedInput,
  updateViewFilterInput,
  viewIdInput,
} from "@/lib/views/saved-views";
import { requireSession } from "@/server/auth/require-session";
import { savedViewService } from "@/server/services";

import { runAction } from "./action-runner";
import { refreshAppShell } from "./refresh";

/**
 * VW-3 saved view mutations. Each re-checks the session first (S-2) and passes the SESSION
 * user to the service, which only ever changes that user's own views (an id in the input
 * cannot reach someone else's). The views are in the sidebar, so the shell is refreshed.
 */

function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  action: (data: z.output<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  return runAction(schema, input, action, refreshAppShell);
}

export async function saveViewAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  return run(saveViewInput, input, (data) => savedViewService.create(session.user.id, data));
}

export async function updateViewFilterAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(updateViewFilterInput, input, async (data) => {
    await savedViewService.updateFilter(session.user.id, data);
    return undefined;
  });
}

export async function renameViewAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(renameViewInput, input, async (data) => {
    await savedViewService.rename(session.user.id, data);
    return undefined;
  });
}

export async function setViewSharedAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(setViewSharedInput, input, async (data) => {
    await savedViewService.setShared(session.user.id, data);
    return undefined;
  });
}

export async function deleteViewAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(viewIdInput, input, async (data) => {
    await savedViewService.remove(session.user.id, data.viewId);
    return undefined;
  });
}

export async function moveViewAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(moveViewInput, input, async (data) => {
    await savedViewService.move(session.user.id, data);
    return undefined;
  });
}
