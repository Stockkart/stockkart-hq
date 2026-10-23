import { z } from "zod";

import { STATUS_CATEGORIES, STATUS_DEFAULT_FOR } from "@/lib/issues/constants";
import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import { labelNameSchema } from "@/lib/issues/schemas";
import { SPRINT_MAX_DAYS } from "@/lib/sprints/constants";

import {
  COMPONENT_NAME_MAX,
  GITHUB_REPO_PATTERN,
  LABEL_COLOR_VALUES,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  STATUS_NAME_MAX,
  WIP_LIMIT_MAX,
  WIP_LIMIT_MIN,
} from "./constants";

/**
 * Zod input schemas for the project settings actions (PRJ-2, PRJ-3). Isomorphic: the
 * settings forms use them for hints; the server always re-validates.
 */

const id = z.uuid();
const projectKey = z.string().regex(PROJECT_KEY_PATTERN);

/** Collapses whitespace, then checks the length. */
const singleLine = (what: string, max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, `${what} is required`).max(max, `${what} is too long`));

// ── General ──────────────────────────────────────────────────────────────────────────────

export const updateProjectInput = z.object({
  projectKey,
  name: singleLine("Name", PROJECT_NAME_MAX),
  /** Empty means none. */
  description: z
    .string()
    .nullish()
    .transform((value) => value?.trim() || null)
    .pipe(z.string().max(PROJECT_DESCRIPTION_MAX, "Description is too long").nullable()),
  leadId: id.nullable(),
  /** PRJ-3: quick create assigns new issues to this user when no assignee is given. */
  defaultAssigneeId: id.nullable(),
  sprintLengthDays: z
    .number()
    .int("Use whole days")
    .min(1, "At least one day")
    .max(SPRINT_MAX_DAYS, `At most ${SPRINT_MAX_DAYS} days`),
});

// ── Workflow (statuses) ──────────────────────────────────────────────────────────────────

const statusName = singleLine("Status name", STATUS_NAME_MAX);
const category = z.enum(STATUS_CATEGORIES);

export const createStatusInput = z.object({ projectKey, name: statusName, category });
export const renameStatusInput = z.object({ statusId: id, name: statusName });
export const setStatusCategoryInput = z.object({ statusId: id, category });
/** Makes this status the default for new bugs (`bug`) or everything else (`other`). */
export const setStatusDefaultInput = z.object({
  statusId: id,
  kind: z.enum(STATUS_DEFAULT_FOR),
});
/** Board order: put `statusId` right after `afterStatusId` (null = first). */
export const moveStatusInput = z
  .object({ statusId: id, afterStatusId: id.nullable() })
  .refine((value) => value.statusId !== value.afterStatusId, "A status cannot follow itself");
/**
 * Deletes a status. When issues (deleted ones included: they keep their status for a
 * restore) still use it, `moveToStatusId` says where they go.
 */
export const deleteStatusInput = z
  .object({ statusId: id, moveToStatusId: id.nullish() })
  .refine((value) => value.statusId !== value.moveToStatusId, "Pick another status");
/** BRD-5: the column's WIP limit, 1…999 (the DB CHECK's range), or null for none. */
export const setStatusWipLimitInput = z.object({
  statusId: id,
  wipLimit: z
    .number("Enter a whole number")
    .int("Enter a whole number")
    .min(WIP_LIMIT_MIN, `At least ${WIP_LIMIT_MIN}`)
    .max(WIP_LIMIT_MAX, `At most ${WIP_LIMIT_MAX}`)
    .nullable(),
});

/** SPR-5: make a retro doc when a sprint is completed. */
export const setAutoRetroInput = z.object({ projectKey, autoRetro: z.boolean() });

// ── Labels ───────────────────────────────────────────────────────────────────────────────

const labelColor = z.enum(LABEL_COLOR_VALUES).nullable();

export const createLabelInput = z.object({
  projectKey,
  name: labelNameSchema,
  color: labelColor,
});
export const renameLabelInput = z.object({ labelId: id, name: labelNameSchema });
export const setLabelColorInput = z.object({ labelId: id, color: labelColor });
export const labelIdInput = z.object({ labelId: id });

// ── Components ───────────────────────────────────────────────────────────────────────────

/** PRJ-2 `Owner/repo`; empty means none. */
export const githubRepoSchema = z
  .string()
  .nullish()
  .transform((value) => value?.trim() || null)
  .pipe(
    z
      .string()
      .regex(GITHUB_REPO_PATTERN, "Use Owner/repo, e.g. Stockkart/inventory-api")
      .nullable(),
  );

export const createComponentInput = z.object({
  projectKey,
  name: singleLine("Component name", COMPONENT_NAME_MAX),
  githubRepo: githubRepoSchema,
});
export const renameComponentInput = z.object({
  componentId: id,
  name: singleLine("Component name", COMPONENT_NAME_MAX),
});
export const setComponentRepoInput = z.object({ componentId: id, githubRepo: githubRepoSchema });
export const componentIdInput = z.object({ componentId: id });
