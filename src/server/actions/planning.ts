"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult } from "@/lib/action-result";
import { moveIssueInput, recordViewInput } from "@/lib/planning/schemas";
import { requireSession } from "@/server/auth/require-session";
import { planningService } from "@/server/services";

import { runAction } from "./action-runner";

/**
 * Backlog ordering and My Work view tracking. Like every action: session first (S-2), then
 * Zod, then the service.
 */

/** BLG-1 drag/keyboard reorder. The backlog and board both show rank order. */
export async function moveIssueAction(input: unknown): Promise<ActionResult<{ rank: string }>> {
  await requireSession();
  return runAction(
    moveIssueInput,
    input,
    (data) => planningService.moveIssue(data),
    () => {
      revalidatePath("/[projectKey]", "layout");
      revalidatePath("/my-work"); // lists my issues in rank order
    },
  );
}

/** MY-1: called once when an issue page opens. Refreshes nothing (no visible change). */
export async function recordIssueViewAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    recordViewInput,
    input,
    async (data) => {
      await planningService.recordIssueView(session.user.id, data);
      return undefined;
    },
    () => {},
  );
}
