"use server";

import { revalidatePath } from "next/cache";
import { type z } from "zod";

import { type ActionResult } from "@/lib/action-result";
import { type IssueType } from "@/lib/issues/constants";
import {
  addLabelInput,
  addLinkInput,
  commentIdInput,
  createCommentInput,
  createIssueInput,
  editCommentInput,
  issueIdInput,
  removeLabelInput,
  removeLinkInput,
  updateIssueFieldInput,
} from "@/lib/issues/schemas";
import { type RichTextDoc } from "@/lib/rich-text";
import { requireSession } from "@/server/auth/require-session";
import { commentService, issueQueries, issueService } from "@/server/services";
import { type CreatedIssue, type FieldChange } from "@/server/services/issues";

import { runAction } from "./action-runner";

/**
 * Issue mutations (ISS-*). Each action re-checks the session first (S-2: action ids can be
 * POSTed from anywhere), then validates its untrusted input with Zod, then calls a service.
 * Expected failures come back as `{ ok: false, error }`; a missing session throws.
 */

/**
 * Issues show on every project page (list, detail, backlog, board) and on My Work, so
 * refresh that whole subtree. Pages are dynamic, so this only re-renders what is open.
 */
function refreshIssuePages() {
  revalidatePath("/[projectKey]", "layout");
  revalidatePath("/my-work");
}

function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  action: (data: z.output<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  return runAction(schema, input, action, refreshIssuePages);
}

export async function createIssueAction(input: unknown): Promise<ActionResult<CreatedIssue>> {
  const session = await requireSession();
  return run(createIssueInput, input, (data) => issueService.createIssue(session.user.id, data));
}

export async function updateIssueFieldAction(input: unknown): Promise<ActionResult<FieldChange>> {
  const session = await requireSession();
  return run(updateIssueFieldInput, input, (data) =>
    issueService.updateIssueField(session.user.id, data),
  );
}

export async function addLabelAction(input: unknown): Promise<ActionResult<{ labelId: string }>> {
  const session = await requireSession();
  return run(addLabelInput, input, (data) => issueService.addLabel(session.user.id, data));
}

export async function removeLabelAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(removeLabelInput, input, async (data) => {
    await issueService.removeLabel(session.user.id, data);
    return undefined;
  });
}

export async function addLinkAction(input: unknown): Promise<ActionResult<{ linkId: string }>> {
  const session = await requireSession();
  return run(addLinkInput, input, (data) => issueService.addLink(session.user.id, data));
}

export async function removeLinkAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(removeLinkInput, input, async (data) => {
    await issueService.removeLink(session.user.id, data);
    return undefined;
  });
}

export async function deleteIssueAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(issueIdInput, input, async (data) => {
    await issueService.deleteIssue(session.user.id, data.issueId);
    return undefined;
  });
}

export async function createCommentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  return run(createCommentInput, input, (data) =>
    commentService.createComment(session.user.id, data),
  );
}

export async function editCommentAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(editCommentInput, input, async (data) => {
    await commentService.editComment(session.user.id, data);
    return undefined;
  });
}

export async function deleteCommentAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(commentIdInput, input, async (data) => {
    await commentService.deleteComment(session.user.id, data.commentId);
    return undefined;
  });
}

/** ISS-10: built-in body per issue type, loaded when the quick-create dialog first opens. */
export async function loadIssueTemplatesAction(): Promise<
  ActionResult<Partial<Record<IssueType, RichTextDoc>>>
> {
  await requireSession();
  return { ok: true, data: await issueQueries.issueTemplates() };
}
