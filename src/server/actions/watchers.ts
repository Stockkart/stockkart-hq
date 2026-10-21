"use server";

import { type ActionResult } from "@/lib/action-result";
import { watchIssueInput } from "@/lib/notifications/schemas";
import { type MentionUser } from "@/lib/notifications/views";
import { requireSession } from "@/server/auth/require-session";
import { mentionQueries, watcherService } from "@/server/services";

import { runAction } from "./action-runner";
import { ISSUE_PAGE, refreshPages } from "./refresh";

/**
 * ISS-11 watch/unwatch and the @mention suggestion list (ISS-7, DOC-9). Watching always
 * applies to the session user; no user id is accepted.
 */

export async function setWatchingAction(
  input: unknown,
): Promise<ActionResult<{ watching: boolean }>> {
  const session = await requireSession();
  return runAction(
    watchIssueInput,
    input,
    (data) => watcherService.setWatching(session.user.id, data),
    () => refreshPages(ISSUE_PAGE),
  );
}

/** Every HQ user (name, email, avatar) for the @mention list; loaded once per page. */
export async function listMentionUsersAction(): Promise<ActionResult<MentionUser[]>> {
  await requireSession();
  return { ok: true, data: await mentionQueries.mentionableUsers() };
}
