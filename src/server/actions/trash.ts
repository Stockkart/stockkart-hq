"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult } from "@/lib/action-result";
import { restoreInput, type RestoreResult } from "@/lib/trash/views";
import { requireSession } from "@/server/auth/require-session";
import { trashService } from "@/server/services";

import { runAction } from "./action-runner";
import {
  ADR_LOG,
  DOC_PAGE,
  ISSUE_VIEWS,
  refreshPages,
  SPRINT_PAGE,
  SPRINTS,
  TODOS,
  TRASH,
} from "./refresh";

/**
 * ISS-13 restore from the trash. Re-checks the session first (S-2). A restored issue
 * reappears on every issue view; a restored doc in the docs tree (the docs layout).
 */
export async function restoreFromTrashAction(input: unknown): Promise<ActionResult<RestoreResult>> {
  const session = await requireSession();
  return runAction(
    restoreInput,
    input,
    (data) => trashService.restore(session.user.id, data),
    () => {
      refreshPages(TRASH, ...ISSUE_VIEWS, DOC_PAGE, SPRINTS, SPRINT_PAGE, ADR_LOG, TODOS);
      revalidatePath("/[projectKey]/docs", "layout");
    },
  );
}
