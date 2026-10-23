"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult } from "@/lib/action-result";
import {
  createReleaseInput,
  deleteReleaseInput,
  markReleasedInput,
  releaseIdInput,
  releaseOptionsInput,
  updateReleaseInput,
} from "@/lib/releases/schemas";
import { type GeneratedNotes, type ReleaseOption } from "@/lib/releases/views";
import { requireSession } from "@/server/auth/require-session";
import { releaseQueries, releaseService } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";

import { runAction } from "./action-runner";
import { DOC_PAGE, ISSUE_VIEWS, refreshPages, RELEASE_VIEWS } from "./refresh";

/**
 * Release mutations (REL-1/2). Like every action: session first (S-2: action ids can be
 * POSTed from anywhere), then Zod, then the service. Each refreshes only the pages that
 * show releases: the release pages, and the issue views when fix versions changed (the
 * issue page's picker lists the releases).
 */

export async function createReleaseAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  return runAction(
    createReleaseInput,
    input,
    (data) => releaseService.createRelease(session.user.id, data),
    () => refreshPages(...RELEASE_VIEWS, ...ISSUE_VIEWS),
  );
}

export async function updateReleaseAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    updateReleaseInput,
    input,
    async (data) => {
      await releaseService.updateRelease(session.user.id, data);
      return undefined;
    },
    // The issue list shows the fix version by name.
    () => refreshPages(...RELEASE_VIEWS, ...ISSUE_VIEWS),
  );
}

/** Deletes an unreleased release (optionally clearing it on its issues first). */
export async function deleteReleaseAction(
  input: unknown,
): Promise<ActionResult<{ cleared: number }>> {
  const session = await requireSession();
  return runAction(
    deleteReleaseInput,
    input,
    (data) => releaseService.deleteRelease(session.user.id, data),
    () => refreshPages(...RELEASE_VIEWS, ...ISSUE_VIEWS),
  );
}

export async function markReleasedAction(
  input: unknown,
): Promise<ActionResult<{ moved: number; openIssues: number }>> {
  const session = await requireSession();
  return runAction(
    markReleasedInput,
    input,
    (data) => releaseService.markReleased(session.user.id, data),
    () => refreshPages(...RELEASE_VIEWS, ...ISSUE_VIEWS),
  );
}

export async function reopenReleaseAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    releaseIdInput,
    input,
    async (data) => {
      await releaseService.reopenRelease(session.user.id, data.releaseId);
      return undefined;
    },
    () => refreshPages(...RELEASE_VIEWS, ...ISSUE_VIEWS),
  );
}

/** REL-2: creates or refreshes the release's notes doc. */
export async function generateReleaseNotesAction(
  input: unknown,
): Promise<ActionResult<GeneratedNotes>> {
  const session = await requireSession();
  return runAction(
    releaseIdInput,
    input,
    (data) => releaseService.generateNotes(session.user.id, data.releaseId),
    () => {
      refreshPages(...RELEASE_VIEWS, DOC_PAGE);
      // The docs tree lives in the docs layout (as the doc actions refresh it).
      revalidatePath("/[projectKey]/docs", "layout");
    },
  );
}

/** Fix-version options of a project, for quick create (loaded when it opens). */
export async function loadReleaseOptionsAction(
  input: unknown,
): Promise<ActionResult<ReleaseOption[]>> {
  await requireSession();
  return runAction(
    releaseOptionsInput,
    input,
    (data) => releaseQueries.releaseOptions(projectIdByKey(data.projectKey)),
    () => {},
  );
}
