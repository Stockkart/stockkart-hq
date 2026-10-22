/**
 * Attachment vocabulary (SPEC §4.3 ISS-9, §4.11 DOC-1 images). Isomorphic: the upload UI
 * checks the same limits the server enforces.
 */

/** What an attachment hangs off (`attachments.entity_type`). */
export const ATTACHMENT_ENTITY_TYPES = ["issue", "comment", "doc"] as const;
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

/**
 * `pending`: a row exists and a presigned PUT was handed out, but the object is not
 * confirmed. `ready`: the server checked the object (HEAD: size and type match). Only
 * `ready` attachments are ever served.
 */
export const ATTACHMENT_STATUSES = ["pending", "ready"] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

/** 10 MB per file. Also a CHECK on `attachments.size_bytes`. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
