"use server";

import { type ActionResult } from "@/lib/action-result";
import {
  createDocCommentInput,
  docCommentIdInput,
  editDocCommentInput,
  resolveDocThreadInput,
} from "@/lib/doc-comments/schemas";
import { requireSession } from "@/server/auth/require-session";
import { commentService } from "@/server/services";

import { runAction } from "./action-runner";
import { DOC_PAGE, refreshPages } from "./refresh";

/**
 * Doc comments (DOC-11 page-level, DOC-13 inline threads). Each action re-checks the session
 * first (S-2), then validates its input with Zod. Only the doc page shows comments, so only
 * it is re-rendered (in the action's own response); the panel shows changes optimistically.
 */

const refreshDocPage = () => refreshPages(DOC_PAGE);

export async function createDocCommentAction(
  input: unknown,
): Promise<ActionResult<{ id: string; threadId: string }>> {
  const session = await requireSession();
  return runAction(
    createDocCommentInput,
    input,
    (data) => commentService.createDocComment(session.user.id, data),
    refreshDocPage,
  );
}

export async function editDocCommentAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    editDocCommentInput,
    input,
    async (data) => {
      await commentService.editComment(session.user.id, data);
      return undefined;
    },
    refreshDocPage,
  );
}

export async function deleteDocCommentAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    docCommentIdInput,
    input,
    async (data) => {
      await commentService.deleteComment(session.user.id, data.commentId);
      return undefined;
    },
    refreshDocPage,
  );
}

export async function resolveDocThreadAction(
  input: unknown,
): Promise<ActionResult<{ resolvedAt: Date | null }>> {
  const session = await requireSession();
  return runAction(
    resolveDocThreadInput,
    input,
    (data) => commentService.setThreadResolved(session.user.id, data),
    refreshDocPage,
  );
}
