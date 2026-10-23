import { z } from "zod";

import { isHandbookPath } from "@/lib/docs/handbook-path";
import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";

import { GIT_SHA_PATTERN, HANDBOOK_PUBLISH_MAX } from "./constants";

/**
 * Zod input schemas of the handbook server actions (DOC-14). Isomorphic: the dialogs reuse
 * them; the server always re-validates.
 */

const id = z.uuid();
const projectKey = z.string().regex(PROJECT_KEY_PATTERN);
const sha = z.string().regex(GIT_SHA_PATTERN, "Not a git object id");

export const handbookPathInput = z
  .string()
  .trim()
  .refine(
    isHandbookPath,
    "Use a relative path such as RUNBOOK.md or decisions/0012-title.md (letters, digits, _ - ., ending in .md)",
  );

export const handbookDocInput = z.object({ docId: id });

export const publishPreviewInput = z.object({ docId: id, path: handbookPathInput.optional() });

export const publishInput = z
  .object({
    projectKey,
    docIds: z
      .array(id)
      .min(1, "Choose at least one doc")
      .max(HANDBOOK_PUBLISH_MAX, `Publish at most ${HANDBOOK_PUBLISH_MAX} docs at a time`),
    /** Single-doc publish only: the path from the path editor. */
    path: handbookPathInput.optional(),
    /**
     * "Keep HQ version": overwrite these docs although the handbook changed, but only while
     * the handbook still has the blob the person reviewed in the diff (`GIT_NULL_SHA`: the
     * file was removed there and the person chose to add it back).
     */
    overwrite: z
      .array(z.object({ docId: id, remoteSha: sha }))
      .max(HANDBOOK_PUBLISH_MAX)
      .default([]),
    /** The person ticked "fine for everyone on the internet to read" (public repo). */
    acknowledgedPublic: z.literal(true, {
      error: "Confirm that the content may be public before publishing",
    }),
    /** Single-doc dialog: the person confirmed a path GitHub gives a meaning to. */
    confirmSpecialPath: z.boolean().default(false),
  })
  .refine((input) => input.path === undefined || input.docIds.length === 1, {
    message: "A path can only be set when publishing one doc",
  })
  .refine((input) => new Set(input.docIds).size === input.docIds.length, {
    message: "A doc is listed twice",
  });

export const pullApplyInput = z.object({
  docId: id,
  /** The HQ version the diff was made from (optimistic lock, §7.4). */
  baseVersion: z.number().int().positive(),
  /** The handbook blob the diff showed; the pull is refused if the file changed since. */
  remoteSha: sha,
});

export const handbookProjectInput = z.object({ projectKey });

export const importHandbookFileInput = z.object({ projectKey, path: handbookPathInput });
