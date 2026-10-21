import { z } from "zod";

import { type IssueType } from "@/lib/issues/constants";
import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";

/**
 * ISS-13 trash: soft-deleted issues and docs of the last `TRASH_DAYS` days, restorable.
 * Older ones are hidden (and can no longer be restored) but never purged by the app.
 */
export const TRASH_DAYS = 30;

export interface TrashedIssue {
  kind: "issue";
  id: string;
  key: string;
  title: string;
  type: IssueType;
  deletedAt: Date;
  deletedBy: string | null;
  /** Its parent is in the trash too (or gone), so a restore makes it parentless. */
  parentDeleted: boolean;
}

export interface TrashedDoc {
  kind: "doc";
  id: string;
  title: string;
  deletedAt: Date;
  deletedBy: string | null;
  /** Its parent page is in the trash too, so a restore puts it at the top level. */
  parentDeleted: boolean;
}

export type TrashItem = TrashedIssue | TrashedDoc;

export const restoreInput = z.object({
  projectKey: z.string().regex(PROJECT_KEY_PATTERN),
  kind: z.enum(["issue", "doc"]),
  id: z.uuid(),
});

export interface RestoreResult {
  /** The parent was deleted, so the item came back without it. */
  detachedFromParent: boolean;
  /** Issue key (issues) for the "Open" link. */
  key: string | null;
}
