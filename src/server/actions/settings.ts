"use server";

import { type z } from "zod";

import { type ActionResult } from "@/lib/action-result";
import {
  componentIdInput,
  createComponentInput,
  createLabelInput,
  createStatusInput,
  deleteStatusInput,
  labelIdInput,
  moveStatusInput,
  renameComponentInput,
  renameLabelInput,
  renameStatusInput,
  setAutoRetroInput,
  setComponentRepoInput,
  setLabelColorInput,
  setStatusCategoryInput,
  setStatusDefaultInput,
  setStatusWipLimitInput,
  updateProjectInput,
} from "@/lib/settings/schemas";
import { saveViewDefaultsInput } from "@/lib/views/view-defaults";
import { requireSession } from "@/server/auth/require-session";
import { projectSettingsService } from "@/server/services";

import { runAction } from "./action-runner";
import {
  BACKLOG,
  BOARD,
  DOC_PAGE,
  ISSUE_LIST,
  ISSUE_PAGE,
  ISSUE_VIEWS,
  PROJECT_SETTINGS,
  refreshPages,
  SPRINT_PAGE,
  SPRINTS,
} from "./refresh";

/**
 * Project settings mutations (PRJ-2, PRJ-3). Each action re-checks the session first (S-2),
 * validates its untrusted input with Zod and calls `projectSettingsService`; expected
 * failures come back as `{ ok: false, error }`.
 */

/** Sprint length and the default assignee: the settings page, backlog and sprint pages. */
const GENERAL_PAGES = [PROJECT_SETTINGS, BACKLOG, SPRINTS];
/** Statuses: board columns, every status field and picker, burndowns, doc issue lists. */
const STATUS_PAGES = [PROJECT_SETTINGS, ...ISSUE_VIEWS, DOC_PAGE, SPRINTS, SPRINT_PAGE];
/** Labels and components show on issues, the lists and the filter options. */
const LABEL_PAGES = [PROJECT_SETTINGS, ISSUE_PAGE, ISSUE_LIST, BACKLOG, BOARD];
const COMPONENT_PAGES = [PROJECT_SETTINGS, ...ISSUE_VIEWS];

function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  action: (data: z.output<S>) => Promise<T>,
  pages: readonly string[],
): Promise<ActionResult<T>> {
  return runAction(schema, input, action, () => refreshPages(...pages));
}

const done = async (work: Promise<void>) => {
  await work;
  return undefined;
};

export async function updateProjectSettingsAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    updateProjectInput,
    input,
    (data) => done(projectSettingsService.updateProject(session.user.id, data)),
    GENERAL_PAGES,
  );
}

export async function createStatusAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  return run(
    createStatusInput,
    input,
    (data) => projectSettingsService.createStatus(session.user.id, data),
    STATUS_PAGES,
  );
}

export async function renameStatusAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    renameStatusInput,
    input,
    (data) => done(projectSettingsService.renameStatus(session.user.id, data)),
    STATUS_PAGES,
  );
}

export async function setStatusCategoryAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    setStatusCategoryInput,
    input,
    (data) => done(projectSettingsService.setStatusCategory(session.user.id, data)),
    STATUS_PAGES,
  );
}

export async function setStatusDefaultAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    setStatusDefaultInput,
    input,
    (data) => done(projectSettingsService.setStatusDefault(session.user.id, data)),
    [PROJECT_SETTINGS],
  );
}

/** BRD-5: a board column's WIP limit (the board header and its amber state). */
export async function setStatusWipLimitAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    setStatusWipLimitInput,
    input,
    (data) => done(projectSettingsService.setStatusWipLimit(session.user.id, data)),
    [PROJECT_SETTINGS, BOARD],
  );
}

/** SPR-5: the "make a retro doc on completion" toggle (General). */
export async function setAutoRetroAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    setAutoRetroInput,
    input,
    (data) => done(projectSettingsService.setAutoRetro(session.user.id, data)),
    [PROJECT_SETTINGS],
  );
}

/**
 * BRD-6 / VW-4: the board's and/or the issue list's default types and hidden statuses
 * (Views tab, the board toolbar, the list's filter bar). Refreshes only the pages that read
 * the side that changed, plus the settings page.
 */
export async function saveViewDefaultsAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    saveViewDefaultsInput,
    input,
    (data) => done(projectSettingsService.saveViewDefaults(session.user.id, data)),
    () => refreshPages(PROJECT_SETTINGS, ...viewDefaultPages(input)),
  );
}

/** The pages a view-defaults save changes (the input was validated before this runs). */
function viewDefaultPages(input: unknown): string[] {
  const parsed = saveViewDefaultsInput.safeParse(input);
  if (!parsed.success) return [];
  return [...(parsed.data.board ? [BOARD] : []), ...(parsed.data.list ? [ISSUE_LIST] : [])];
}

export async function moveStatusAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    moveStatusInput,
    input,
    (data) => done(projectSettingsService.moveStatus(session.user.id, data)),
    STATUS_PAGES,
  );
}

export async function deleteStatusAction(input: unknown): Promise<ActionResult<{ moved: number }>> {
  const session = await requireSession();
  return run(
    deleteStatusInput,
    input,
    (data) => projectSettingsService.deleteStatus(session.user.id, data),
    STATUS_PAGES,
  );
}

export async function createLabelAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  return run(
    createLabelInput,
    input,
    (data) => projectSettingsService.createLabel(session.user.id, data),
    LABEL_PAGES,
  );
}

export async function renameLabelAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    renameLabelInput,
    input,
    (data) => done(projectSettingsService.renameLabel(session.user.id, data)),
    LABEL_PAGES,
  );
}

export async function setLabelColorAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    setLabelColorInput,
    input,
    (data) => done(projectSettingsService.setLabelColor(session.user.id, data)),
    LABEL_PAGES,
  );
}

export async function deleteLabelAction(
  input: unknown,
): Promise<ActionResult<{ detached: number }>> {
  const session = await requireSession();
  return run(
    labelIdInput,
    input,
    (data) => projectSettingsService.deleteLabel(session.user.id, data.labelId),
    LABEL_PAGES,
  );
}

export async function createComponentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  return run(
    createComponentInput,
    input,
    (data) => projectSettingsService.createComponent(session.user.id, data),
    COMPONENT_PAGES,
  );
}

export async function renameComponentAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    renameComponentInput,
    input,
    (data) => done(projectSettingsService.renameComponent(session.user.id, data)),
    COMPONENT_PAGES,
  );
}

export async function setComponentRepoAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return run(
    setComponentRepoInput,
    input,
    (data) => done(projectSettingsService.setComponentRepo(session.user.id, data)),
    [PROJECT_SETTINGS, ISSUE_PAGE],
  );
}

export async function deleteComponentAction(
  input: unknown,
): Promise<ActionResult<{ unset: number }>> {
  const session = await requireSession();
  return run(
    componentIdInput,
    input,
    (data) => projectSettingsService.deleteComponent(session.user.id, data.componentId),
    COMPONENT_PAGES,
  );
}
