"use server";

import { type ActionResult } from "@/lib/action-result";
import { githubLoginInput } from "@/lib/github/schemas";
import { requireSession } from "@/server/auth/require-session";
import { profileService } from "@/server/services";

import { runAction } from "./action-runner";
import { ISSUE_PAGE, PROFILE, refreshPages } from "./refresh";

/**
 * Profile settings. The user is ALWAYS the session user: no action accepts a user id, so
 * nobody can change another user's profile.
 */
export async function setGithubLoginAction(
  input: unknown,
): Promise<ActionResult<{ githubLogin: string | null }>> {
  const session = await requireSession();
  return runAction(
    githubLoginInput,
    input,
    (data) => profileService.setGithubLogin(session.user.id, data),
    // The Development panel maps GitHub authors to HQ users by this name (GH-4).
    () => refreshPages(PROFILE, ISSUE_PAGE),
  );
}
