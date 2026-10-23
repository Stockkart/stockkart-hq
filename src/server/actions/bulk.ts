"use server";

import { type ActionResult } from "@/lib/action-result";
import { bulkEditInput, type BulkEditResult } from "@/lib/issues/bulk";
import { requireSession } from "@/server/auth/require-session";
import { bulkService } from "@/server/services";

import { runAction } from "./action-runner";
import {
  ADR_LOG,
  DOC_PAGE,
  ISSUE_VIEWS,
  refreshPages,
  RELEASE_VIEWS,
  SPRINT_PAGE,
  SPRINTS,
  TODOS,
  TRASH,
} from "./refresh";

/**
 * ISS-12 bulk edit from the issue list and the backlog. Re-checks the session first (S-2);
 * the input is validated (at most `BULK_MAX` ids) before the service runs; the whole batch
 * is one statement, so it applies to every selected issue or to none.
 */
export async function bulkEditIssuesAction(input: unknown): Promise<ActionResult<BulkEditResult>> {
  const session = await requireSession();
  return runAction(
    bulkEditInput,
    input,
    (data) => bulkService.bulkEdit(session.user.id, data),
    // As the single-field edits (and deletes) refresh, plus the trash.
    () =>
      refreshPages(
        ...ISSUE_VIEWS,
        DOC_PAGE,
        SPRINTS,
        SPRINT_PAGE,
        ADR_LOG,
        TODOS,
        TRASH,
        ...RELEASE_VIEWS,
      ),
  );
}
