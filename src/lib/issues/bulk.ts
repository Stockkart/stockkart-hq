import { z } from "zod";

import { PRIORITIES } from "./constants";
import { PROJECT_KEY_PATTERN } from "./keys";

/**
 * ISS-12 bulk edit from the issue list and the backlog. Isomorphic: the bulk bar builds the
 * input, the server re-validates it. One change per call, applied to every selected issue in
 * ONE statement (all or nothing).
 */

/** Most issues one bulk edit takes; the bulk bar refuses more before calling. */
export const BULK_MAX = 200;

const id = z.uuid();
const labelIds = z
  .array(id)
  .min(1, "Pick at least one label")
  .max(50, "Too many labels at once")
  .transform((ids) => [...new Set(ids)]);

export const bulkChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status"), statusId: id }),
  z.object({ kind: z.literal("priority"), priority: z.literal([...PRIORITIES]) }),
  z.object({ kind: z.literal("assignee"), assigneeId: id.nullable() }),
  /** BLG-3: a planned or active sprint, or null for the backlog. */
  z.object({ kind: z.literal("sprint"), sprintId: id.nullable() }),
  /** REL-1 "Fix version": a release of the project, or null for none. */
  z.object({ kind: z.literal("release"), releaseId: id.nullable() }),
  z.object({ kind: z.literal("addLabels"), labelIds }),
  z.object({ kind: z.literal("removeLabels"), labelIds }),
  /** Soft delete (ISS-13: restorable from the trash for 30 days). */
  z.object({ kind: z.literal("delete") }),
]);
export type BulkChange = z.input<typeof bulkChangeSchema>;

export const bulkEditInput = z.object({
  projectKey: z.string().regex(PROJECT_KEY_PATTERN),
  issueIds: z
    .array(id)
    .min(1, "Select at least one issue")
    .max(BULK_MAX, `Select at most ${BULK_MAX} issues at once`)
    .transform((ids) => [...new Set(ids)]),
  change: bulkChangeSchema,
});
export type BulkEditInput = z.input<typeof bulkEditInput>;

export interface BulkEditResult {
  /** Issues whose value actually changed (one activity row each). */
  changed: number;
}
