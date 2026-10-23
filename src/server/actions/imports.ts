"use server";

import { type ActionResult } from "@/lib/action-result";
import { applyImportInput, previewImportInput } from "@/lib/imports/schemas";
import { type ImportApplyResult, type ImportPreview } from "@/lib/imports/views";
import { requireSession } from "@/server/auth/require-session";
import { importService } from "@/server/services";

import { runAction } from "./action-runner";
import { ISSUE_VIEWS, PROJECT_SETTINGS, refreshPages, SPRINT_PAGE, SPRINTS } from "./refresh";

/**
 * IMP-4 CSV import. Session first (S-2), then Zod: at most `IMPORT_MAX_ROWS` rows of
 * bounded cells, so an oversized request is refused before any work. The file itself never
 * reaches the server (the browser parses it and sends the mapped cells).
 */

export async function previewImportAction(input: unknown): Promise<ActionResult<ImportPreview>> {
  const session = await requireSession();
  return runAction(
    previewImportInput,
    input,
    (data) => importService.preview(session.user.id, data),
    // The history on the settings page's Import tab.
    () => refreshPages(PROJECT_SETTINGS),
  );
}

export async function applyImportAction(input: unknown): Promise<ActionResult<ImportApplyResult>> {
  const session = await requireSession();
  return runAction(
    applyImportInput,
    input,
    (data) => importService.apply(session.user.id, data),
    () => refreshPages(PROJECT_SETTINGS, ...ISSUE_VIEWS, SPRINTS, SPRINT_PAGE),
  );
}
