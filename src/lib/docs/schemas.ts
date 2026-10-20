import { z } from "zod";

import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import { richTextDocSchema } from "@/lib/rich-text";

import { ADR_STATUSES, DOC_STATUSES, PICKABLE_DOC_TYPES } from "./constants";

/**
 * Zod input schemas for the doc server actions (DOC-*, ADR-*). Shared with forms; the server
 * always re-validates.
 */

export const DOC_TITLE_MAX = 255;
/** Siblings are few; this only bounds the index a client may send. */
const MAX_INDEX = 10_000;

const id = z.uuid();
const title = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Title is required").max(DOC_TITLE_MAX, "Title is too long"));
const projectKey = z.string().regex(PROJECT_KEY_PATTERN);

export const createDocInput = z.object({
  projectKey,
  title,
  /** Ignored when a template is given: the template decides the type (DOC-5). */
  type: z.enum(PICKABLE_DOC_TYPES).default("page"),
  parentId: id.nullish(),
  templateId: id.nullish(),
});
export type CreateDocInput = z.input<typeof createDocInput>;

/** ADR-1: the number and the "NNNN. " prefix are added by the server. */
export const createAdrInput = z.object({
  projectKey,
  title: title.pipe(z.string().max(DOC_TITLE_MAX - 6, "Title is too long")),
});

/**
 * §7.4 autosave. `baseVersion` is the version the editor started from; the write succeeds
 * only if the doc is still at that version. `title` is sent only when it changed.
 */
export const saveDocInput = z.object({
  docId: id,
  baseVersion: z.number().int().positive(),
  title: title.optional(),
  content: richTextDocSchema,
  /** "Save version": always keep a snapshot of this save. */
  snapshot: z.boolean().default(false),
});

export const renameDocInput = z.object({ docId: id, title });

/** Fields outside the optimistic lock: last write wins per field (§9.4). */
export const updateDocMetaInput = z.discriminatedUnion("field", [
  z.object({ docId: id, field: z.literal("type"), value: z.enum(PICKABLE_DOC_TYPES) }),
  z.object({ docId: id, field: z.literal("status"), value: z.enum(DOC_STATUSES) }),
  z.object({ docId: id, field: z.literal("owner"), value: id.nullable() }),
  z.object({
    docId: id,
    field: z.literal("adrStatus"),
    value: z.enum(ADR_STATUSES),
    /** Required for `superseded`, ignored otherwise (ADR-2 "Superseded by NNNN"). */
    supersededBy: id.nullish(),
  }),
]);

/** DOC-2: new parent (null = top level) and the index among its other children. */
export const moveDocInput = z.object({
  docId: id,
  parentId: id.nullable(),
  index: z.number().int().min(0).max(MAX_INDEX),
});

export const docIdInput = z.object({ docId: id });

export const linkIssueInput = z.object({
  docId: id,
  issueKey: z.string().trim().min(1, "Issue key is required").max(20),
});

export const unlinkIssueInput = z.object({ docId: id, linkId: id });
