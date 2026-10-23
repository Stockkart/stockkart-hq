import { z } from "zod";

import { richTextDocSchema } from "@/lib/rich-text";

import { DEFAULT_PRIORITY, ISSUE_TYPES, LINK_RELATIONS, PRIORITIES } from "./constants";
import { PROJECT_KEY_PATTERN } from "./keys";

/**
 * Zod input schemas for the issue server actions. Shared with forms so client-side hints
 * match the server, but the server always re-validates (inputs are untrusted).
 */

export const TITLE_MAX = 255;
export const LABEL_MAX = 40;

const id = z.uuid();
const title = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Title is required").max(TITLE_MAX, "Title is too long"));
const priority = z.literal([...PRIORITIES]);
const isoDate = z.iso.date();

/** RDM-1: a start and a due date (either may be null); the due date is not before the start. */
export const issueScheduleSchema = z
  .object({ startDate: isoDate.nullable(), dueDate: isoDate.nullable() })
  .refine((value) => !value.startDate || !value.dueDate || value.startDate <= value.dueDate, {
    message: "The end date is before the start date",
    path: ["dueDate"],
  });

export const createIssueInput = z.object({
  projectKey: z.string().regex(PROJECT_KEY_PATTERN),
  title,
  type: z.enum(ISSUE_TYPES).default("task"),
  priority: priority.default(DEFAULT_PRIORITY),
  description: richTextDocSchema.nullish(),
  parentId: id.nullish(),
  assigneeId: id.nullish(),
  componentId: id.nullish(),
  /** BLG-3: a planned or active sprint of the project; omitted = the backlog. */
  sprintId: id.nullish(),
  /** REL-1 "Fix version": a release of the project; omitted = none. */
  releaseId: id.nullish(),
});
export type CreateIssueInput = z.input<typeof createIssueInput>;

/** One field per call (§9.4: last write wins per field, every change lands in `activity`). */
export const updateIssueFieldInput = z.discriminatedUnion("field", [
  z.object({ issueId: id, field: z.literal("title"), value: title }),
  z.object({ issueId: id, field: z.literal("description"), value: richTextDocSchema.nullable() }),
  z.object({ issueId: id, field: z.literal("status"), value: id }),
  z.object({ issueId: id, field: z.literal("priority"), value: priority }),
  z.object({ issueId: id, field: z.literal("assignee"), value: id.nullable() }),
  z.object({ issueId: id, field: z.literal("component"), value: id.nullable() }),
  z.object({
    issueId: id,
    field: z.literal("storyPoints"),
    value: z.number().int().min(0).max(999).nullable(),
  }),
  z.object({ issueId: id, field: z.literal("dueDate"), value: isoDate.nullable() }),
  z.object({ issueId: id, field: z.literal("parent"), value: id.nullable() }),
  /** BLG-3: a planned or active sprint, or null for the backlog. */
  z.object({ issueId: id, field: z.literal("sprint"), value: id.nullable() }),
  /**
   * RDM-1 roadmap bar: `start_date` and `due_date` together, so a moved bar is one write
   * (one activity row per date that changed) and never briefly ends before it starts.
   */
  z.object({ issueId: id, field: z.literal("schedule"), value: issueScheduleSchema }),
  /** REL-1 "Fix version": a release of the issue's project, or null for none. */
  z.object({ issueId: id, field: z.literal("release"), value: id.nullable() }),
]);
export type UpdateIssueFieldInput = z.input<typeof updateIssueFieldInput>;
export type IssueField = UpdateIssueFieldInput["field"];

/** ISS-14 clone: a copy of the issue (see `cloneIssue` for what is copied). */
export const cloneIssueInput = z.object({ issueId: id });

/** ISS-14 convert: change the issue's type, within the ISS-3 parent rules. */
export const convertIssueTypeInput = z.object({ issueId: id, type: z.enum(ISSUE_TYPES) });

/** A label name: trimmed, spaces to dashes, lower case (shared with project settings). */
export const labelNameSchema = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, "-").toLowerCase())
  .pipe(
    z
      .string()
      .min(1, "Label is required")
      .max(LABEL_MAX, "Label is too long")
      .regex(/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u, "Use letters, numbers, '.', '_' or '-'"),
  );

export const addLabelInput = z.object({ issueId: id, name: labelNameSchema });

export const removeLabelInput = z.object({ issueId: id, labelId: id });

export const addLinkInput = z.object({
  issueId: id,
  relation: z.enum(LINK_RELATIONS),
  targetKey: z.string().trim().min(1, "Issue key is required").max(20),
});

export const removeLinkInput = z.object({ issueId: id, linkId: id });

export const issueIdInput = z.object({ issueId: id });

export const createCommentInput = z.object({ issueId: id, body: richTextDocSchema });
export const editCommentInput = z.object({ commentId: id, body: richTextDocSchema });
export const commentIdInput = z.object({ commentId: id });
