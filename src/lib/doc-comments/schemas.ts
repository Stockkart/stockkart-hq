import { z } from "zod";

import { DOC_COMMENT_ANCHOR_ID_PATTERN } from "@/lib/docs/constants";
import { isEmptyDoc, richTextDocSchema } from "@/lib/rich-text";

import { anchorQuote } from "./anchors";

/**
 * Inputs of the doc comment actions (DOC-11 page-level, DOC-13 inline). Isomorphic: the
 * panel's forms use them too; the server always re-validates.
 */

const id = z.uuid();
const body = richTextDocSchema.refine((doc) => !isEmptyDoc(doc), "Write a comment first");

/** The selection a new inline thread is anchored to (the mark is already in the doc). */
const anchor = z.object({
  id: z.string().regex(DOC_COMMENT_ANCHOR_ID_PATTERN, "Invalid comment anchor"),
  // Bounded before the transform, so a huge string is refused instead of being trimmed.
  text: z
    .string()
    .max(20_000)
    .transform((text) => anchorQuote(text) || null),
});

/**
 * A new thread (page-level without `anchor`, inline with it) or a reply (`parentId`, the
 * thread's top comment). Replies are one level deep and carry no anchor of their own,
 * matching the `comments_reply_plain` CHECK.
 */
export const createDocCommentInput = z
  .object({
    docId: id,
    body,
    anchor: anchor.optional(),
    parentId: id.optional(),
  })
  .refine((input) => !(input.anchor && input.parentId), {
    message: "A reply belongs to its thread and cannot have an anchor of its own",
  });
export type CreateDocCommentInput = z.input<typeof createDocCommentInput>;
export type CreateDocCommentData = z.output<typeof createDocCommentInput>;

export const editDocCommentInput = z.object({ commentId: id, body });

export const docCommentIdInput = z.object({ commentId: id });

/** Resolve (true) or reopen (false) a thread; always on its top comment. */
export const resolveDocThreadInput = z.object({ commentId: id, resolved: z.boolean() });
