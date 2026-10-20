"use server";

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
import {
  BACKLOG,
  BOARD,
  DOC_PAGE,
  ISSUE_LIST,
  ISSUE_PAGE,
  ISSUE_VIEWS,
  refreshPages,
} from "./refresh";

/**
 * Issue mutations (ISS-*). Each action re-checks the session first (S-2: action ids can be
 * POSTed from anywhere), then validates its untrusted input with Zod, then calls a service.
 * Expected failures come back as `{ ok: false, error }`; a missing session throws.
 */

/**
 * Each action refreshes only the pages that show what it changed (see `refresh.ts`): the
 * issue views for field changes, just the issue page for links and comments. The open page
 * re-renders in the same response, while the client already shows the change.
 */
function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  action: (data: z.output<S>) => Promise<T>,
  pages: readonly string[],
): Promise<ActionResult<T>> {
  return runAction(schema, input, action, () => refreshPages(...pages));
}

/** Field changes also show in the Linked issues panel of doc pages. */
const FIELD_PAGES = [...ISSUE_VIEWS, DOC_PAGE];
/** Labels show on the issue, the lists and in the filter options. */
const LABEL_PAGES = [ISSUE_PAGE, ISSUE_LIST, BACKLOG, BOARD];
/** Links and comments (and the mentions in them) show on issue pages only. */
const ISSUE_PAGE_ONLY = [ISSUE_PAGE];

export async function createIssueAction(input: unknown): Promise<ActionResult<CreatedIssue>> {
  const session = await requireSession();
  return run(
    createIssueInput,
    input,
    (data) => issueService.createIssue(session.user.id, data),
    ISSUE_VIEWS,
  );
}

export async function updateIssueFieldAction(input: unknown): Promise<ActionResult<FieldChange>> {
  const session = await requireSession();
  return run(
    updateIssueFieldInput,
    input,
    (data) => issueService.updateIssueField(session.user.id, data),
    FIELD_PAGES,
  );
}

export async function addLabelAction(input: unknown): Promise<ActionResult<{ labelId: string }>> {
  const session = await requireSession();
  return run(
    addLabelInput,
    input,
    (data) => issueService.addLabel(session.user.id, data),
    LABEL_PAGES,
  );
}

export async function removeLabelAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    removeLabelInput,
    input,
    async (data) => {
      await issueService.removeLabel(session.user.id, data);
      return undefined;
    },
    LABEL_PAGES,
  );
}

export async function addLinkAction(input: unknown): Promise<ActionResult<{ linkId: string }>> {
  const session = await requireSession();
  return run(
    addLinkInput,
    input,
    (data) => issueService.addLink(session.user.id, data),
    ISSUE_PAGE_ONLY,
  );
}

export async function removeLinkAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    removeLinkInput,
    input,
    async (data) => {
      await issueService.removeLink(session.user.id, data);
      return undefined;
    },
    ISSUE_PAGE_ONLY,
  );
}

export async function deleteIssueAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    issueIdInput,
    input,
    async (data) => {
      await issueService.deleteIssue(session.user.id, data.issueId);
      return undefined;
    },
    FIELD_PAGES,
  );
}

export async function createCommentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  return run(
    createCommentInput,
    input,
    (data) => commentService.createComment(session.user.id, data),
    ISSUE_PAGE_ONLY,
  );
}

export async function editCommentAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    editCommentInput,
    input,
    async (data) => {
      await commentService.editComment(session.user.id, data);
      return undefined;
    },
    ISSUE_PAGE_ONLY,
  );
}

export async function deleteCommentAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    commentIdInput,
    input,
    async (data) => {
      await commentService.deleteComment(session.user.id, data.commentId);
      return undefined;
    },
    ISSUE_PAGE_ONLY,
  );
}

/** ISS-10: built-in body per issue type, loaded when the quick-create dialog first opens. */
export async function loadIssueTemplatesAction(): Promise<
  ActionResult<Partial<Record<IssueType, RichTextDoc>>>
> {
  await requireSession();
  return { ok: true, data: await issueQueries.issueTemplates() };
}
