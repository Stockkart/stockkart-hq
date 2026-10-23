import { z } from "zod";

import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";

import { RELEASE_DESCRIPTION_MAX, RELEASE_NAME_MAX } from "./constants";

/**
 * Zod input schemas for the release actions (REL-1/2). Isomorphic: the dialogs use them for
 * hints, and the server always re-validates.
 */

const id = z.uuid();
/** Spaces collapsed and trimmed; e.g. "api-v1.4". Unique per project (DB index). */
const name = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Name is required").max(RELEASE_NAME_MAX, "Name is too long"));
/** Empty means none. */
const description = z
  .string()
  .nullish()
  .transform((value) => value?.trim() || null)
  .pipe(z.string().max(RELEASE_DESCRIPTION_MAX, "Description is too long").nullable());
/** The target date (`YYYY-MM-DD`); empty means none. */
const releaseDate = z
  .string()
  .nullish()
  .transform((value) => value?.trim() || null)
  .pipe(z.iso.date("Use a date like 2026-06-30").nullable());

export const releaseFormInput = z.object({ name, releaseDate, description });

export const createReleaseInput = releaseFormInput.extend({
  projectKey: z.string().regex(PROJECT_KEY_PATTERN),
});
export type CreateReleaseInput = z.input<typeof createReleaseInput>;

export const updateReleaseInput = releaseFormInput.extend({ releaseId: id });
export type UpdateReleaseInput = z.input<typeof updateReleaseInput>;

export const releaseIdInput = z.object({ releaseId: id });

/**
 * REL-1 delete: only an unreleased release. With issues it is refused unless
 * `unsetIssues` is true, which first clears the fix version on them (activity rows).
 */
export const deleteReleaseInput = z.object({
  releaseId: id,
  unsetIssues: z.boolean().default(false),
});

/**
 * REL-1 "Mark released". `openIssues` says what to do with issues that are not done yet:
 * omitted = refuse when there are any (the warning path), `keep` = release anyway, `move` =
 * move them to another unreleased release first.
 */
export const markReleasedInput = z
  .object({
    releaseId: id,
    openIssues: z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("keep") }),
        z.object({ action: z.literal("move"), targetReleaseId: id }),
      ])
      .optional(),
  })
  .refine(
    (value) =>
      value.openIssues?.action !== "move" || value.openIssues.targetReleaseId !== value.releaseId,
    "Move the open issues to another release",
  );
export type MarkReleasedInput = z.input<typeof markReleasedInput>;

/** REL-1 fix-version options for quick create (loaded when the dialog opens). */
export const releaseOptionsInput = z.object({ projectKey: z.string().regex(PROJECT_KEY_PATTERN) });
