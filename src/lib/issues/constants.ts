/**
 * Issue vocabulary shared by the schema, server code and UI (SPEC §4.3, §4.4). Isomorphic:
 * safe to import from client components.
 */

/** ISS-1. Order is the order shown in pickers. */
export const ISSUE_TYPES = [
  "epic",
  "story",
  "task",
  "bug",
  "spike",
  "tech_debt",
  "subtask",
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  epic: "Epic",
  story: "Story",
  task: "Task",
  bug: "Bug",
  spike: "Spike",
  tech_debt: "Tech-debt",
  subtask: "Subtask",
};

/** ISS-2: 0 = P0 Critical … 3 = P3 Low. New issues default to P2. */
export const PRIORITIES = [0, 1, 2, 3] as const;
export type Priority = (typeof PRIORITIES)[number];
export const DEFAULT_PRIORITY: Priority = 2;

export const PRIORITY_LABELS: Record<Priority, string> = {
  0: "P0 Critical",
  1: "P1 High",
  2: "P2 Medium",
  3: "P3 Low",
};

/** §4.4: every status belongs to one category; reports use categories. */
export const STATUS_CATEGORIES = ["todo", "in_progress", "done"] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

/** `statuses.is_default_for`: Triage is the default for bugs, Backlog for everything else. */
export const STATUS_DEFAULT_FOR = ["bug", "other"] as const;
export type StatusDefaultFor = (typeof STATUS_DEFAULT_FOR)[number];

/**
 * ISS-6. Stored link types; the inverse ("is blocked by", "is duplicated by") is derived from
 * the viewpoint, never stored. `relates` is symmetric.
 */
export const ISSUE_LINK_TYPES = ["blocks", "relates", "duplicates"] as const;
export type IssueLinkType = (typeof ISSUE_LINK_TYPES)[number];

/** What the user picks in the "Link" form: a stored type plus a direction. */
export const LINK_RELATIONS = [
  "blocks",
  "is_blocked_by",
  "relates",
  "duplicates",
  "is_duplicated_by",
] as const;
export type LinkRelation = (typeof LINK_RELATIONS)[number];

export const LINK_RELATION_LABELS: Record<LinkRelation, string> = {
  blocks: "blocks",
  is_blocked_by: "is blocked by",
  relates: "relates to",
  duplicates: "duplicates",
  is_duplicated_by: "is duplicated by",
};

/** `entity_links` / `comments` / `activity` polymorphic targets (SPEC §8). `user` is the
 * target of @mentions (ISS-7, DOC-9, MY-1). `sprint` is the subject of the sprint
 * lifecycle activity (SPR-1/2: `sprint_started` holds the burndown's start snapshot). */
export const ENTITY_TYPES = [
  "issue",
  "doc",
  "diagram",
  "incident",
  "comment",
  "user",
  "sprint",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Things that can be commented on (SPEC §8 `comments.entity_type`). */
export const COMMENT_ENTITY_TYPES = ["issue", "doc"] as const;
export type CommentEntityType = (typeof COMMENT_ENTITY_TYPES)[number];
