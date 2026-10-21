import { z } from "zod";

import { ATTACHMENT_ENTITY_TYPES, MAX_ATTACHMENT_BYTES } from "./constants";

/** Server action inputs for ISS-9 uploads. Isomorphic: the upload UI checks the same limits. */

const MAX_DIMENSION = 20_000;
const dimension = z.number().int().positive().max(MAX_DIMENSION);

/** No control characters (they would end up in Content-Disposition and the UI). */
const filename = z
  .string()
  .trim()
  .min(1, "The file has no name")
  .max(255, "The file name is too long")
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value), "The file name has invalid characters");

export const startUploadInput = z.object({
  entityType: z.enum(ATTACHMENT_ENTITY_TYPES),
  entityId: z.uuid(),
  filename,
  /** The browser's type: untrusted, may be empty. The policy picks the stored type. */
  mime: z.string().max(255),
  size: z
    .number()
    .int()
    .min(1, "The file is empty")
    .max(MAX_ATTACHMENT_BYTES, "Files can be at most 10 MB"),
  width: dimension.optional(),
  height: dimension.optional(),
});
export type StartUploadInput = z.infer<typeof startUploadInput>;

export const attachmentIdInput = z.object({ attachmentId: z.uuid() });

/**
 * `draft`: the file was added to a comment that is not posted yet. It belongs to the issue
 * until then, but the page is not refreshed for it (it shows inline in the comment).
 */
export const confirmUploadInput = attachmentIdInput.extend({ draft: z.boolean().optional() });

/** Moves a new comment's uploads (made while it was a draft on its issue) onto the comment. */
export const adoptCommentAttachmentsInput = z.object({
  commentId: z.uuid(),
  attachmentIds: z.array(z.uuid()).min(1).max(50),
});
