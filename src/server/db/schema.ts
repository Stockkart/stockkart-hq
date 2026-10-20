import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { ADR_STATUSES, DOC_STATUSES, DOC_TYPES, TEMPLATE_KINDS } from "@/lib/docs/constants";
import {
  COMMENT_ENTITY_TYPES,
  ENTITY_TYPES,
  ISSUE_LINK_TYPES,
  ISSUE_TYPES,
  STATUS_CATEGORIES,
  STATUS_DEFAULT_FOR,
} from "@/lib/issues/constants";
import { type RichTextDoc } from "@/lib/rich-text";

/**
 * SPEC §8. Phase 0 tables (users, login_attempts) plus every table Phase 1 needs, defined up
 * front so the Phase 1 slices (issues; backlog/board/todos/search; docs/ADRs) share one
 * migration. Diagrams, watchers, saved views, notifications, attachments, GitHub refs,
 * incidents and services arrive with their phases.
 *
 * Conventions:
 * - Every table has `id uuid`, `created_at`, `updated_at` unless SPEC §8 says otherwise.
 * - Soft-deletable tables have `deleted_at`; queries must filter `deleted_at IS NULL`.
 * - Ordering columns (`issues.rank`, `docs.position`, `todos.position`) hold
 *   `fractional-indexing` keys and use the "C" collation, because the keys are only ordered
 *   correctly by plain byte comparison (a locale collation may ignore case or punctuation).
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Full-text search vector; always a GENERATED column with a GIN index (SRCH-2). */
const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/** A `fractional-indexing` key, compared bytewise (see the conventions above). */
const fractionalKey = customType<{ data: string }>({
  dataType: () => 'text COLLATE "C"',
});

// ── Enums ────────────────────────────────────────────────────────────────────────────────

export const issueTypeEnum = pgEnum("issue_type", ISSUE_TYPES);
export const statusCategoryEnum = pgEnum("status_category", STATUS_CATEGORIES);
export const statusDefaultForEnum = pgEnum("status_default_for", STATUS_DEFAULT_FOR);
export const issueLinkTypeEnum = pgEnum("issue_link_type", ISSUE_LINK_TYPES);
export const entityTypeEnum = pgEnum("entity_type", ENTITY_TYPES);
export const commentEntityTypeEnum = pgEnum("comment_entity_type", COMMENT_ENTITY_TYPES);
/** `manual`: added by a person. `mention`: derived from `STK-123` in text, resynced on edit. */
export const entityLinkOriginEnum = pgEnum("entity_link_origin", ["manual", "mention"]);
export const sprintStateEnum = pgEnum("sprint_state", ["planned", "active", "closed"]);
export const releaseStateEnum = pgEnum("release_state", ["unreleased", "released"]);
export const docTypeEnum = pgEnum("doc_type", DOC_TYPES);
export const docStatusEnum = pgEnum("doc_status", DOC_STATUSES);
export const adrStatusEnum = pgEnum("adr_status", ADR_STATUSES);
export const templateKindEnum = pgEnum("template_kind", TEMPLATE_KINDS);

// ── Phase 0: sign-in ─────────────────────────────────────────────────────────────────────

/** HQ user, created on first sign-in and keyed by the Stockkart (inventory-api) userId. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  stockkartUserId: text("stockkart_user_id").notNull().unique(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  avatarUrl: text("avatar_url"),
  githubLogin: text("github_login"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  // S-3: "sign out everywhere" (P1) bumps this; sessions carrying an older value are rejected.
  sessionVersion: integer("session_version").notNull().default(0),
  ...timestamps,
});

/**
 * AUTH-8 rate limiting. One row per sign-in attempt per key, where key is
 * `email:<normalised email>` or `ip:<client ip>`.
 */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    success: boolean("success").notNull(),
  },
  (table) => [index("login_attempts_key_attempted_at_idx").on(table.key, table.attemptedAt)],
);

// ── Projects (PRJ-1, PRJ-2) ──────────────────────────────────────────────────────────────

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    leadId: uuid("lead_id").references(() => users.id, { onDelete: "set null" }),
    /** Last issue number handed out; see `allocate` in services/issues.ts. Never decremented. */
    issueCounter: integer("issue_counter").notNull().default(0),
    sprintLengthDays: integer("sprint_length_days").notNull().default(14),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check("projects_key_format", sql`${table.key} ~ '^[A-Z]{2,5}$'`),
    check("projects_issue_counter_nonneg", sql`${table.issueCounter} >= 0`),
  ],
);

export const components = pgTable(
  "components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** `Owner/repo`, e.g. `Stockkart/inventory-api`; used by GH-2 later. */
    githubRepo: text("github_repo"),
    ...timestamps,
  },
  (table) => [uniqueIndex("components_project_name_unique").on(table.projectId, table.name)],
);

/** §4.4 workflow. One set per project; WF-1 allows any → any. */
export const statuses = pgTable(
  "statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: statusCategoryEnum("category").notNull(),
    position: integer("position").notNull(),
    isDefaultFor: statusDefaultForEnum("is_default_for"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("statuses_project_name_unique").on(table.projectId, table.name),
    // At most one default per kind per project.
    uniqueIndex("statuses_project_default_unique")
      .on(table.projectId, table.isDefaultFor)
      .where(sql`${table.isDefaultFor} IS NOT NULL`),
  ],
);

export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    ...timestamps,
  },
  (table) => [uniqueIndex("labels_project_name_unique").on(table.projectId, table.name)],
);

// ── Sprints and releases (SPR-*, REL-*; tables now, features later) ─────────────────────

export const sprints = pgTable(
  "sprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    state: sprintStateEnum("state").notNull().default("planned"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("sprints_project_idx").on(table.projectId),
    // SPR-1: one active sprint per project.
    uniqueIndex("sprints_one_active_per_project")
      .on(table.projectId)
      .where(sql`${table.state} = 'active'`),
  ],
);

export const releases = pgTable(
  "releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    releaseDate: date("release_date"),
    state: releaseStateEnum("state").notNull().default("unreleased"),
    notesDocId: uuid("notes_doc_id").references((): AnyPgColumn => docs.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [uniqueIndex("releases_project_name_unique").on(table.projectId, table.name)],
);

// ── Issues (ISS-*) ───────────────────────────────────────────────────────────────────────

export const issues = pgTable(
  "issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Restrict: deleting a project must never silently drop its issues (projects archive).
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    /** `STK-<number>`; allocated from `projects.issue_counter`, never reused. */
    number: integer("number").notNull(),
    type: issueTypeEnum("type").notNull(),
    title: text("title").notNull(),
    description: jsonb("description").$type<RichTextDoc>(),
    /** Derived on the server from `description`; feeds `search`. */
    descriptionText: text("description_text").notNull().default(""),
    statusId: uuid("status_id")
      .notNull()
      .references(() => statuses.id, { onDelete: "restrict" }),
    /** 0 = P0 Critical … 3 = P3 Low. */
    priority: smallint("priority").notNull().default(2),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => issues.id, {
      onDelete: "set null",
    }),
    componentId: uuid("component_id").references(() => components.id, { onDelete: "set null" }),
    sprintId: uuid("sprint_id").references(() => sprints.id, { onDelete: "set null" }),
    releaseId: uuid("release_id").references(() => releases.id, { onDelete: "set null" }),
    storyPoints: integer("story_points"),
    dueDate: date("due_date"),
    startDate: date("start_date"),
    /**
     * Backlog order (BLG-1): a `fractional-indexing` key, lowest first. Moving an issue only
     * rewrites its own key (a key between its new neighbours), never its neighbours'. Unique
     * per project so two writers racing for the same gap cannot both win; the loser retries
     * with fresh neighbours.
     */
    rank: fractionalKey("rank").notNull(),
    /** Set when the issue enters a `done`-category status; cleared when it leaves (§4.4). */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('english'::regconfig, coalesce("title", '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce("description_text", '')), 'B')`,
    ),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("issues_project_number_unique").on(table.projectId, table.number),
    uniqueIndex("issues_project_rank_unique").on(table.projectId, table.rank),
    index("issues_project_status_idx").on(table.projectId, table.statusId),
    index("issues_project_sprint_rank_idx").on(table.projectId, table.sprintId, table.rank),
    index("issues_assignee_open_idx")
      .on(table.assigneeId)
      .where(sql`${table.resolvedAt} IS NULL`),
    index("issues_parent_idx").on(table.parentId),
    index("issues_search_idx").using("gin", table.search),
    check("issues_number_positive", sql`${table.number} > 0`),
    check("issues_priority_range", sql`${table.priority} BETWEEN 0 AND 3`),
    check("issues_story_points_range", sql`${table.storyPoints} BETWEEN 0 AND 999`),
    check("issues_not_own_parent", sql`${table.parentId} IS DISTINCT FROM ${table.id}`),
  ],
);

export const issueLabels = pgTable(
  "issue_labels",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.issueId, table.labelId] }),
    index("issue_labels_label_idx").on(table.labelId),
  ],
);

/**
 * ISS-6. One row per link, stored in its "active" direction (`source blocks target`); the
 * inverse wording is derived when viewed from the target.
 */
export const issueLinks = pgTable(
  "issue_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceIssueId: uuid("source_issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    targetIssueId: uuid("target_issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    type: issueLinkTypeEnum("type").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("issue_links_unique").on(table.sourceIssueId, table.targetIssueId, table.type),
    index("issue_links_target_idx").on(table.targetIssueId),
    check("issue_links_not_self", sql`${table.sourceIssueId} <> ${table.targetIssueId}`),
  ],
);

/** Typed links between any two things (issue ↔ doc ↔ diagram ↔ incident). No FKs: polymorphic. */
export const entityLinks = pgTable(
  "entity_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromType: entityTypeEnum("from_type").notNull(),
    fromId: uuid("from_id").notNull(),
    toType: entityTypeEnum("to_type").notNull(),
    toId: uuid("to_id").notNull(),
    origin: entityLinkOriginEnum("origin").notNull().default("manual"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("entity_links_unique").on(
      table.fromType,
      table.fromId,
      table.toType,
      table.toId,
      table.origin,
    ),
    index("entity_links_to_idx").on(table.toType, table.toId),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: commentEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: jsonb("body").$type<RichTextDoc>().notNull(),
    bodyText: text("body_text").notNull().default(""),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('english'::regconfig, coalesce("body_text", ''))`,
    ),
    ...timestamps,
  },
  (table) => [
    index("comments_entity_idx").on(table.entityType, table.entityId, table.createdAt),
    index("comments_search_idx").using("gin", table.search),
  ],
);

/**
 * ISS-8 history and the source for burndown (SPR-3). Append-only, so no `updated_at`.
 * `from_value`/`to_value` hold raw values (ids, numbers, ISO dates); the UI resolves names.
 */
export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: entityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    /** Null for system/GitHub events (GH-3). */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    field: text("field"),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt,
  },
  (table) => [
    index("activity_entity_created_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt.desc(),
    ),
  ],
);

// ── Docs and templates (DOC-*, ADR-*) ────────────────────────────────────────────────────

export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: templateKindEnum("kind").notNull(),
    /** Issue type, doc type or diagram kind the template is for. */
    subtype: text("subtype").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    content: jsonb("content").$type<RichTextDoc>().notNull(),
    builtIn: boolean("built_in").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    // The seed upserts built-ins on this key, so re-running it never duplicates them.
    uniqueIndex("templates_built_in_unique")
      .on(table.kind, table.subtype)
      .where(sql`${table.builtIn}`),
  ],
);

export const docs = pgTable(
  "docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    /** DOC-2 page tree. Deleting a parent lifts its children to the root. */
    parentId: uuid("parent_id").references((): AnyPgColumn => docs.id, { onDelete: "set null" }),
    type: docTypeEnum("type").notNull().default("page"),
    title: text("title").notNull(),
    content: jsonb("content").$type<RichTextDoc>(),
    contentText: text("content_text").notNull().default(""),
    status: docStatusEnum("status").notNull().default("draft"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    /** Optimistic locking (§7.4, §9.4): `UPDATE … WHERE version = base`. */
    version: integer("version").notNull().default(1),
    /** Sibling order in the page tree; a fractional key like `issues.rank`. */
    position: fractionalKey("position").notNull(),
    adrNumber: integer("adr_number"),
    adrStatus: adrStatusEnum("adr_status"),
    adrSupersededBy: uuid("adr_superseded_by").references((): AnyPgColumn => docs.id, {
      onDelete: "set null",
    }),
    templateId: uuid("template_id").references(() => templates.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('english'::regconfig, coalesce("title", '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce("content_text", '')), 'B')`,
    ),
    ...timestamps,
  },
  (table) => [
    index("docs_project_parent_position_idx").on(table.projectId, table.parentId, table.position),
    // ADR-1: numbers are unique per project.
    uniqueIndex("docs_project_adr_number_unique")
      .on(table.projectId, table.adrNumber)
      .where(sql`${table.adrNumber} IS NOT NULL`),
    index("docs_search_idx").using("gin", table.search),
    check("docs_version_positive", sql`${table.version} > 0`),
    check("docs_not_own_parent", sql`${table.parentId} IS DISTINCT FROM ${table.id}`),
  ],
);

/** Full snapshot per saved version (§7.3). Immutable, so no `updated_at`. */
export const docVersions = pgTable(
  "doc_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    docId: uuid("doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    content: jsonb("content").$type<RichTextDoc>(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    createdAt,
  },
  (table) => [uniqueIndex("doc_versions_doc_version_unique").on(table.docId, table.version)],
);

// ── Personal todos (MY-2, MY-3) ──────────────────────────────────────────────────────────

export const todos = pgTable(
  "todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    done: boolean("done").notNull().default(false),
    /** A fractional key like `issues.rank`. */
    position: fractionalKey("position").notNull(),
    promotedIssueId: uuid("promoted_issue_id").references(() => issues.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [index("todos_user_position_idx").on(table.userId, table.position)],
);

export type UserRow = typeof users.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type StatusRow = typeof statuses.$inferSelect;
export type IssueRow = typeof issues.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type ActivityRow = typeof activity.$inferSelect;
