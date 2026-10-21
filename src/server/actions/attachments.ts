"use server";

import { type ActionResult } from "@/lib/action-result";
import { type AttachmentEntityType } from "@/lib/attachments/constants";
import {
  adoptCommentAttachmentsInput,
  attachmentIdInput,
  confirmUploadInput,
  startUploadInput,
} from "@/lib/attachments/schemas";
import { type AttachmentView, type StartedUpload } from "@/lib/attachments/views";
import { requireSession } from "@/server/auth/require-session";
import { attachmentService } from "@/server/services";

import { runAction } from "./action-runner";
import { DOC_PAGE, ISSUE_PAGE, refreshPages } from "./refresh";

/**
 * ISS-9 attachment actions (see `services/attachments.ts` for the upload flow). Each one
 * re-checks the session first (S-2), then validates its input with Zod.
 *
 * Only the attachments panel shows files, so only the issue or doc page is refreshed; a
 * comment's files are inline in the comment, which its own actions refresh.
 */
function pagesFor(entityType: AttachmentEntityType): string[] {
  if (entityType === "issue") return [ISSUE_PAGE];
  if (entityType === "doc") return [DOC_PAGE];
  return [];
}

export async function startUploadAction(input: unknown): Promise<ActionResult<StartedUpload>> {
  const session = await requireSession();
  // A pending upload is not shown anywhere: nothing to refresh.
  return runAction(
    startUploadInput,
    input,
    (data) => attachmentService.startUpload(session.user.id, data),
    () => undefined,
  );
}

export async function confirmUploadAction(input: unknown): Promise<ActionResult<AttachmentView>> {
  const session = await requireSession();
  let pages: string[] = [];
  return runAction(
    confirmUploadInput,
    input,
    async (data) => {
      const view = await attachmentService.confirmUpload(session.user.id, data.attachmentId);
      pages = data.draft ? [] : pagesFor(view.entityType);
      return view;
    },
    () => refreshPages(...pages),
  );
}

export async function cancelUploadAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    attachmentIdInput,
    input,
    async (data) => {
      await attachmentService.cancelUpload(session.user.id, data.attachmentId);
      return undefined;
    },
    () => undefined,
  );
}

export async function deleteAttachmentAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  let pages: string[] = [];
  return runAction(
    attachmentIdInput,
    input,
    async (data) => {
      const { entityType } = await attachmentService.deleteAttachment(
        session.user.id,
        data.attachmentId,
      );
      pages = pagesFor(entityType);
      return undefined;
    },
    () => refreshPages(...pages),
  );
}

export async function adoptCommentAttachmentsAction(
  input: unknown,
): Promise<ActionResult<{ moved: number }>> {
  const session = await requireSession();
  return runAction(
    adoptCommentAttachmentsInput,
    input,
    (data) => attachmentService.adoptForComment(session.user.id, data),
    // The files leave the issue's panel.
    () => refreshPages(ISSUE_PAGE, DOC_PAGE),
  );
}
