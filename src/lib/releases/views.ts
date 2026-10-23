import { type IssueType, type StatusCategory } from "@/lib/issues/constants";

import { type ReleaseState } from "./constants";

/** Release read models passed from server components to client components. Plain data only. */

/** A release in a "Fix version" picker (issue side panel, quick create, bulk bar, filter). */
export interface ReleaseOption {
  id: string;
  name: string;
  state: ReleaseState;
}

export interface ReleaseTally {
  count: number;
  points: number;
}

/** A row of the releases page (REL-1). */
export interface ReleaseSummary {
  id: string;
  name: string;
  description: string | null;
  /** Target date, ISO `YYYY-MM-DD`. */
  releaseDate: string | null;
  state: ReleaseState;
  releasedAt: Date | null;
  /** Live issues with this fix version, and those in a done-category status. */
  total: ReleaseTally;
  done: ReleaseTally;
  /** The generated notes doc, when it is live (a trashed doc counts as none). */
  notesDocId: string | null;
}

/** What "Generate release notes" did (REL-2). */
export type NotesOutcome =
  /** A new doc (and, the first time, the "Release notes" parent page). */
  | "created"
  /** The generated doc was untouched since the last generation: rewritten in place. */
  | "updated"
  /** The doc was edited since: the edits are kept as a version, the notes are a new one. */
  | "new_version"
  /** Nothing changed since the last generation (or a concurrent one already made it). */
  | "unchanged";

export interface GeneratedNotes {
  docId: string;
  outcome: NotesOutcome;
}

/** An issue of a release (detail page and the notes generator). */
export interface ReleaseIssue {
  id: string;
  key: string;
  number: number;
  title: string;
  type: IssueType;
  storyPoints: number | null;
  status: { id: string; name: string; category: StatusCategory };
}
