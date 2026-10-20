import { z } from "zod";

/**
 * Zod input schemas for the backlog/board/My Work actions. Isomorphic; the server always
 * re-validates.
 */

/**
 * BLG-1 reorder: put `issueId` right after `afterIssueId` (null = the very top). Moves are
 * expressed by the issue that should precede the moved one, never by an index, so a stale
 * client cannot misplace an issue among rows it has not loaded.
 */
export const moveIssueInput = z
  .object({ issueId: z.uuid(), afterIssueId: z.uuid().nullable() })
  .refine((value) => value.issueId !== value.afterIssueId, "An issue cannot follow itself");

/** MY-1 "recently viewed". */
export const recordViewInput = z.object({ issueId: z.uuid() });
