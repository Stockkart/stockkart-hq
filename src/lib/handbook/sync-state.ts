import { GIT_NULL_SHA, type HandbookSyncStatus } from "./constants";

/**
 * The sync status of one doc (DOC-14; README "Engineering handbook sync"), from the stored
 * columns only: the page never asks GitHub (README "Performance"). Isomorphic and pure.
 *
 *   PR open              an open publication holds the doc (one at most, by the index)
 *   Removed in handbook  the default branch no longer has the file (`GIT_NULL_SHA`), and the
 *                        doc was there before (synced or imported)
 *   In sync / Changed in HQ / Changed in handbook / Both changed
 *                        synced docs: HQ changed ⇔ `version > handbook_synced_version`;
 *                        the handbook changed ⇔ a remote blob was seen that is not the
 *                        synced one (`NULL` with a seen-at = "a push touched it, blob unknown")
 *   Never synced         the file is (or may be) in the handbook — imported, or seen on the
 *                        default branch — but there is no common base: "Changed in handbook"
 *                        while HQ never edited the doc, else "Both changed". Otherwise
 *                        "Not in handbook".
 */

export interface HandbookSyncFields {
  version: number;
  sourcePath: string | null;
  /** `updated_by IS NOT NULL`: someone edited the doc in HQ (imports write NULL). */
  editedInHq: boolean;
  handbookBlobSha: string | null;
  handbookSyncedVersion: number | null;
  handbookRemoteSha: string | null;
  handbookRemoteSeenAt: Date | null;
  openPr: { number: number | null; url: string | null } | null;
}

export function handbookSyncStatus(doc: HandbookSyncFields): HandbookSyncStatus {
  if (doc.openPr) return "pr_open";
  const seen = doc.handbookRemoteSeenAt !== null;
  const removed = seen && doc.handbookRemoteSha === GIT_NULL_SHA;
  const synced = doc.handbookBlobSha !== null && doc.handbookSyncedVersion !== null;
  if (removed) return synced || doc.sourcePath !== null ? "removed_in_handbook" : "not_in_handbook";
  if (!synced) {
    if (!seen && doc.sourcePath === null) return "not_in_handbook";
    return doc.editedInHq ? "both_changed" : "changed_in_handbook";
  }
  const hqChanged = doc.version > (doc.handbookSyncedVersion ?? 0);
  const repoChanged = seen && doc.handbookRemoteSha !== doc.handbookBlobSha;
  if (hqChanged && repoChanged) return "both_changed";
  if (hqChanged) return "changed_in_hq";
  if (repoChanged) return "changed_in_handbook";
  return "in_sync";
}

/** Whether "Review & pull" applies (something may be newer in the handbook). */
export function canPull(status: HandbookSyncStatus): boolean {
  return status === "changed_in_handbook" || status === "both_changed";
}

/**
 * The stored status as of a newer saved `version` than the one it was read at (an autosave
 * on the open page, before any refresh): a save since then means HQ changed, so "In sync"
 * becomes "Changed in HQ" and "Changed in handbook" becomes "Both changed". Pure.
 */
export function statusAtVersion(
  sync: { status: HandbookSyncStatus; version: number },
  version: number,
): HandbookSyncStatus {
  if (version <= sync.version) return sync.status;
  if (sync.status === "in_sync") return "changed_in_hq";
  if (sync.status === "changed_in_handbook") return "both_changed";
  return sync.status;
}

/** `abc1234` for activity text and labels. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
