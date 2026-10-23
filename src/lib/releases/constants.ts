import { type IssueType } from "@/lib/issues/constants";

/**
 * Release vocabulary (SPEC §4.8 REL-1/2). Isomorphic: shared by the Zod schemas, the
 * services and the UI.
 */

/** `releases.state` (the `release_state` enum). */
export const RELEASE_STATES = ["unreleased", "released"] as const;
export type ReleaseState = (typeof RELEASE_STATES)[number];

export const RELEASE_NAME_MAX = 60;
export const RELEASE_DESCRIPTION_MAX = 2000;

/** `activity.action` values on `entity_type = 'release'`. */
export const RELEASE_ACTIONS = {
  created: "release_created",
  /** One row per changed field (`field` = name / releaseDate / description). */
  updated: "updated",
  released: "released",
  reopened: "reopened",
  deleted: "release_deleted",
  /** REL-2: `meta` = `{ docId, version }`, the doc version this generation wrote. */
  notesGenerated: "notes_generated",
} as const;

/** The release's fields as written to `activity.field`. */
export const RELEASE_FIELDS = ["name", "releaseDate", "description"] as const;
export type ReleaseField = (typeof RELEASE_FIELDS)[number];

/** REL-2: the root page the release-notes docs are nested under (created when missing). */
export const RELEASE_NOTES_PARENT_TITLE = "Release notes";

/** REL-2: "Release notes — api-v1.4". */
export const releaseNotesTitle = (name: string) => `Release notes — ${name}`;

/** REL-2 sections of the generated notes, in order, and the issue types each one lists. */
export const RELEASE_NOTE_SECTIONS: readonly { title: string; types: readonly IssueType[] }[] = [
  { title: "Features", types: ["story", "epic"] },
  { title: "Fixes", types: ["bug"] },
  { title: "Tech debt & other", types: ["task", "spike", "tech_debt", "subtask"] },
];
