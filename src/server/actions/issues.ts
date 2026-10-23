"use server";

import { type z } from "zod";

import { type ActionResult } from "@/lib/action-result";
import { type IssueType } from "@/lib/issues/constants";
import {
  addLabelInput,
  addLinkInput,
  cloneIssueInput,
  commentIdInput,
  convertIssueTypeInput,
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
  ADR_LOG,
  BACKLOG,
  BOARD,
  DOC_PAGE,
  INCIDENT_PAGE,
  ISSUE_LIST,
  ISSUE_PAGE,
  ISSUE_VIEWS,
  refreshPages,
  RELEASE_VIEWS,
  ROADMAP,
  SPRINT_PAGE,
  SPRINTS,
  TODOS,
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

/** Field changes also show in the Linked issues panel of doc pages, and (status, points,
 * sprint) in the sprint tallies and burndowns, and (status, points, fix version) in the
 * release progress (REL-1), and (title, status) in an incident's follow-ups (INC-2). */
const FIELD_PAGES = [
  ...ISSUE_VIEWS,
  DOC_PAGE,
  SPRINTS,
  SPRINT_PAGE,
  ...RELEASE_VIEWS,
  INCIDENT_PAGE,
];
/** A deleted issue also leaves the ADR log's links and a promoted todo's link. */
const DELETE_PAGES = [...FIELD_PAGES, ADR_LOG, TODOS];
/** Labels show on the issue, the lists and in the filter options. */
const LABEL_PAGES = [ISSUE_PAGE, ISSUE_LIST, BACKLOG, BOARD];
/** Links and comments (and the mentions in them) show on issue pages only. */
const ISSUE_PAGE_ONLY = [ISSUE_PAGE];
/** Links also draw the roadmap's dependency arrows (RDM-2, `blocks` between epics). */
const LINK_PAGES = [ISSUE_PAGE, ROADMAP];

export async function createIssueAction(input: unknown): Promise<ActionResult<CreatedIssue>> {
  const session = await requireSession();
  return run(
    createIssueInput,
    input,
    (data) => issueService.createIssue(session.user.id, data),
    // A new issue may go straight into a sprint (BLG-3) or a fix version (REL-1).
    [...ISSUE_VIEWS, SPRINTS, SPRINT_PAGE, ...RELEASE_VIEWS],
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
    LINK_PAGES,
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
    LINK_PAGES,
  );
}

/** ISS-14: a copy of the issue, linked to it with `relates`; the client opens the copy. */
export async function cloneIssueAction(input: unknown): Promise<ActionResult<CreatedIssue>> {
  const session = await requireSession();
  return run(
    cloneIssueInput,
    input,
    (data) => issueService.cloneIssue(session.user.id, data),
    // A new issue (like create), a new link on the original's page, and the doc links of
    // the copied description's issue keys (DOC-9).
    [...ISSUE_VIEWS, SPRINTS, SPRINT_PAGE, DOC_PAGE],
  );
}

/** ISS-14: change the issue's type within the ISS-3 parent rules. */
export async function convertIssueTypeAction(input: unknown): Promise<ActionResult<FieldChange>> {
  const session = await requireSession();
  return run(
    convertIssueTypeInput,
    input,
    (data) => issueService.convertIssueType(session.user.id, data),
    FIELD_PAGES,
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
    DELETE_PAGES,
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
