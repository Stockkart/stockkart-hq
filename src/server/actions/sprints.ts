"use server";

import { type ActionResult } from "@/lib/action-result";
import {
  completeSprintInput,
  createSprintInput,
  moveIssueToSprintInput,
  sprintIdInput,
  updateSprintInput,
} from "@/lib/sprints/schemas";
import { requireSession } from "@/server/auth/require-session";
import { planningService, sprintService } from "@/server/services";
import { type CompletedSprint } from "@/server/services/sprints";

import { runAction } from "./action-runner";
import { ISSUE_LIST, MY_WORK, refreshPages, SPRINT_VIEWS } from "./refresh";

/**
 * Sprint mutations (SPR-1, SPR-2, BLG-3). Like every action: session first (S-2: action ids
 * can be POSTed from anywhere), then Zod, then the service. Each refreshes only the pages
 * that show sprints or sprint membership.
 */

const refreshSprintViews = () => refreshPages(...SPRINT_VIEWS);

export async function createSprintAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  return runAction(
    createSprintInput,
    input,
    (data) => sprintService.createSprint(session.user.id, data),
    refreshSprintViews,
  );
}

export async function updateSprintAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    updateSprintInput,
    input,
    async (data) => {
      await sprintService.updateSprint(session.user.id, data);
      return undefined;
    },
    refreshSprintViews,
  );
}

/** Deletes a planned sprint; its issues go back to the backlog. */
export async function deleteSprintAction(input: unknown): Promise<ActionResult<{ moved: number }>> {
  const session = await requireSession();
  return runAction(
    sprintIdInput,
    input,
    (data) => sprintService.deleteSprint(session.user.id, data.sprintId),
    refreshSprintViews,
  );
}

export async function startSprintAction(
  input: unknown,
): Promise<ActionResult<{ committedPoints: number; issueIds: string[] }>> {
  const session = await requireSession();
  return runAction(
    sprintIdInput,
    input,
    (data) => sprintService.startSprint(session.user.id, data.sprintId),
    refreshSprintViews,
  );
}

export async function completeSprintAction(input: unknown): Promise<ActionResult<CompletedSprint>> {
  const session = await requireSession();
  return runAction(
    completeSprintInput,
    input,
    (data) => sprintService.completeSprint(session.user.id, data),
    refreshSprintViews,
  );
}

/** BLG-3 drag between sprint sections and the backlog, or the "Move to sprint…" menu. */
export async function moveIssueToSprintAction(
  input: unknown,
): Promise<ActionResult<{ rank: string; sprintId: string | null }>> {
  const session = await requireSession();
  return runAction(
    moveIssueToSprintInput,
    input,
    (data) => planningService.moveIssueToSprint(session.user.id, data),
    // The issue list and My Work show rank order (and `updated_at`) too.
    () => refreshPages(...SPRINT_VIEWS, ISSUE_LIST, MY_WORK),
  );
}
