"use server";

import { type ActionResult } from "@/lib/action-result";
import {
  handbookDocInput,
  handbookProjectInput,
  importHandbookFileInput,
  publishInput,
  publishPreviewInput,
  pullApplyInput,
} from "@/lib/handbook/schemas";
import {
  type CheckOutcome,
  type PublishOutcome,
  type PublishPreview,
  type PullPreview,
} from "@/lib/handbook/views";
import { requireSession } from "@/server/auth/require-session";
import { handbookPublishService, handbookPullService } from "@/server/services";

import { runAction } from "./action-runner";
import { ADR_LOG, DOC_PAGE, PROJECT_SETTINGS, refreshDocsTree, refreshPages } from "./refresh";

/**
 * DOC-14 handbook sync actions. Each starts with `await requireSession()` (S-2), validates
 * with Zod and calls a service. Every service call fails closed with "Handbook sync isn't
 * set up" while the GitHub App is not configured. GitHub is only called from here (on a
 * person's click), never while a page renders.
 */

const noRefresh = () => {};
/** Sync state shows on the doc pages and the settings Handbook tab. */
const refreshSync = () => refreshPages(DOC_PAGE, PROJECT_SETTINGS);

/** Publish dialog: markdown, checks and the diff against the repo (reads GitHub). */
export async function handbookPublishPreviewAction(
  input: unknown,
): Promise<ActionResult<PublishPreview>> {
  const session = await requireSession();
  return runAction(
    publishPreviewInput,
    input,
    (data) => handbookPublishService.preview(session.user.id, data),
    noRefresh,
  );
}

export async function handbookPublishAction(input: unknown): Promise<ActionResult<PublishOutcome>> {
  const session = await requireSession();
  return runAction(
    publishInput,
    input,
    (data) => handbookPublishService.publish(session.user.id, data),
    refreshSync,
  );
}

/** Pull dialog: diff of HQ against the handbook file, and the state (reads GitHub). */
export async function handbookPullPreviewAction(
  input: unknown,
): Promise<ActionResult<PullPreview>> {
  const session = await requireSession();
  return runAction(
    handbookDocInput,
    input,
    (data) => handbookPullService.preview(session.user.id, data.docId),
    // The preview records the blob it saw, so the badge may change.
    refreshSync,
  );
}

/** "Take handbook version" / the clean pull: a new HQ version. */
export async function handbookPullApplyAction(
  input: unknown,
): Promise<ActionResult<{ version: number }>> {
  const session = await requireSession();
  return runAction(
    pullApplyInput,
    input,
    (data) => handbookPullService.apply(session.user.id, data),
    () => {
      // The title can change (tree, ADR log).
      refreshPages(DOC_PAGE, PROJECT_SETTINGS, ADR_LOG);
      refreshDocsTree();
    },
  );
}

/** "Check handbook now" (rate-limited to once a minute per project). */
export async function handbookCheckAction(input: unknown): Promise<ActionResult<CheckOutcome>> {
  const session = await requireSession();
  return runAction(
    handbookProjectInput,
    input,
    (data) => handbookPullService.check(session.user.id, data.projectKey),
    refreshSync,
  );
}

/** "Import" of a "New in handbook" file. */
export async function handbookImportFileAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  return runAction(
    importHandbookFileInput,
    input,
    (data) => handbookPullService.importFile(session.user.id, data),
    () => {
      refreshPages(PROJECT_SETTINGS, ADR_LOG);
      refreshDocsTree();
    },
  );
}
