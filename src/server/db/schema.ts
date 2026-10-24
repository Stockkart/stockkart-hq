import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import {
  ATTACHMENT_ENTITY_TYPES,
  ATTACHMENT_STATUSES,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/attachments/constants";
import { DIAGRAM_KINDS, DIAGRAM_SCENE_MAX_BYTES } from "@/lib/diagrams/constants";
import {
  BILLING_CYCLES,
  COST_CATEGORIES,
  COST_ENTRY_KINDS,
  COST_NAME_MAX,
  DEFAULT_BASE_CURRENCY,
  DEFAULT_REMINDER_DAY,
  MAX_AMOUNT_MINOR,
  REMINDER_DAY_MAX,
  REMINDER_DAY_MIN,
} from "@/lib/costs/constants";
import {
  ADR_STATUSES,
  DOC_COMMENT_ANCHOR_TEXT_MAX,
  DOC_STATUSES,
  DOC_TYPES,
  TEMPLATE_KINDS,
} from "@/lib/docs/constants";
import { GITHUB_PR_STATES, GITHUB_REF_KINDS } from "@/lib/github/constants";
import {
  GIT_SHA_REGEX_SOURCE,
  HANDBOOK_BRANCH_REGEX_SOURCE,
  HANDBOOK_ERROR_CODE_REGEX_SOURCE,
  HANDBOOK_PR_URL_REGEX_SOURCE,
  HANDBOOK_PUBLICATION_STATES,
} from "@/lib/handbook/constants";
import { HANDBOOK_PATH_MAX, HANDBOOK_PATH_REGEX_SOURCE } from "@/lib/docs/handbook-path";
import {
  IMPORT_FILENAME_MAX,
  IMPORT_KINDS,
  IMPORT_REPORT_MAX_BYTES,
  IMPORT_STATUSES,
} from "@/lib/imports/constants";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TIMELINE_BODY_MAX,
  INCIDENT_TIMELINE_KINDS,
  INCIDENT_TITLE_MAX,
} from "@/lib/incidents/constants";
import {
  COMMENT_ENTITY_TYPES,
  ENTITY_TYPES,
  ISSUE_LINK_TYPES,
  ISSUE_TYPES,
  type Priority,
  STATUS_CATEGORIES,
  STATUS_DEFAULT_FOR,
} from "@/lib/issues/constants";
import {
  DIGEST_FREQUENCIES,
  EMAIL_DELIVERY_KINDS,
  EMAIL_DELIVERY_STATUSES,
  EMAIL_ERROR_CODE_MAX,
  NOTIFICATION_TYPES,
} from "@/lib/notifications/constants";
import { type RichTextDoc } from "@/lib/rich-text";
import {
  SERVICE_MAX_ENVIRONMENTS,
  SERVICE_MAX_LINKS,
  SERVICE_SLUG_MAX,
  type ServiceEnvironment,
  type ServiceLink,
} from "@/lib/service-registry/constants";

/**
 * SPEC §8. Phase 0 tables (users, login_attempts) plus every table Phase 1 needs, defined up
 * front so the Phase 1 slices (issues; backlog/board/todos/search; docs/ADRs) share one
 * migration. GitHub refs and deliveries arrived with GH-1…GH-4. The Phase 2 (P1) foundation
 * (migration 0004) added watchers, notifications, saved views, attachments, diagrams and
 * diagram versions in one go, so the P1 feature slices need no migration of their own.
 * The P2 foundation (migration 0005) does the same for the P2 slices: services, incidents
 * (with their services and timeline), email deliveries, imports, inline doc comment
 * columns, WIP limits, sprint retro docs and release fields.
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

/** CHECK body for a handbook repo path: the `isHandbookPath` rules (lib/docs/handbook-path). */
function handbookPathCheck(column: SQL, nullable: boolean): SQL {
  const rule = sql`(${column} ~ ${sql.raw(`'${HANDBOOK_PATH_REGEX_SOURCE}'`)}
    AND char_length(${column}) <= ${sql.raw(String(HANDBOOK_PATH_MAX))}
    AND strpos(${column}, '..') = 0)`;
  return nullable ? sql`${column} IS NULL OR ${rule}` : rule;
}

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
export const notificationTypeEnum = pgEnum("notification_type", NOTIFICATION_TYPES);
export const attachmentEntityTypeEnum = pgEnum("attachment_entity_type", ATTACHMENT_ENTITY_TYPES);
export const attachmentStatusEnum = pgEnum("attachment_status", ATTACHMENT_STATUSES);
export const diagramKindEnum = pgEnum("diagram_kind", DIAGRAM_KINDS);
// P2 foundation (migration 0005).
export const incidentSeverityEnum = pgEnum("incident_severity", INCIDENT_SEVERITIES);
export const incidentStatusEnum = pgEnum("incident_status", INCIDENT_STATUSES);
export const incidentTimelineKindEnum = pgEnum("incident_timeline_kind", INCIDENT_TIMELINE_KINDS);
export const digestFrequencyEnum = pgEnum("digest_frequency", DIGEST_FREQUENCIES);
export const emailDeliveryKindEnum = pgEnum("email_delivery_kind", EMAIL_DELIVERY_KINDS);
export const emailDeliveryStatusEnum = pgEnum("email_delivery_status", EMAIL_DELIVERY_STATUSES);
export const importKindEnum = pgEnum("import_kind", IMPORT_KINDS);
export const importStatusEnum = pgEnum("import_status", IMPORT_STATUSES);
// Handbook sync foundation (migration 0006).
export const handbookPublicationStateEnum = pgEnum(
  "handbook_publication_state",
  HANDBOOK_PUBLICATION_STATES,
);
// Costs (migration 0007).
export const costCategoryEnum = pgEnum("cost_category", COST_CATEGORIES);
export const billingCycleEnum = pgEnum("billing_cycle", BILLING_CYCLES);
export const costEntryKindEnum = pgEnum("cost_entry_kind", COST_ENTRY_KINDS);

// ── Phase 0: sign-in ─────────────────────────────────────────────────────────────────────

/** HQ user, created on first sign-in and keyed by the Stockkart (inventory-api) userId. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stockkartUserId: text("stockkart_user_id").notNull().unique(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    avatarUrl: text("avatar_url"),
    githubLogin: text("github_login"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    // S-3: "sign out everywhere" (P1) bumps this; sessions carrying an older value are rejected.
    sessionVersion: integer("session_version").notNull().default(0),
    /** NTF-2 (P2) email digest opt-in. Off until the user turns it on. */
    notifyEmail: boolean("notify_email").notNull().default(false),
    /** NTF-2 cadence once opted in. */
    digestFrequency: digestFrequencyEnum("digest_frequency").notNull().default("daily"),
    /** End of the last digest period sent (or skipped), so the next one starts there. */
    lastDigestAt: timestamp("last_digest_at", { withTimezone: true }),
    /**
     * NTF-2 one-click unsubscribe: the sha-256 (lowercase hex) of a random token that only
     * the emailed link holds. The token itself is never stored, so a database read cannot
     * unsubscribe anyone. Null until the first digest is sent; rotate it to revoke old links.
     */
    emailUnsubscribeTokenHash: text("email_unsubscribe_token_hash"),
    ...timestamps,
  },
  (table) => [
    // GH-4: one HQ user per GitHub account; GitHub logins are case-insensitive.
    uniqueIndex("users_github_login_unique")
      .on(sql`lower(${table.githubLogin})`)
      .where(sql`${table.githubLogin} IS NOT NULL`),
    // The unsubscribe route looks the user up by hash.
    uniqueIndex("users_email_unsubscribe_token_hash_unique")
      .on(table.emailUnsubscribeTokenHash)
      .where(sql`${table.emailUnsubscribeTokenHash} IS NOT NULL`),
    check(
      "users_email_unsubscribe_token_hash_format",
      sql`${table.emailUnsubscribeTokenHash} IS NULL OR ${table.emailUnsubscribeTokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

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
    /** PRJ-3: assignee for new issues created without one. Null: unassigned. */
    defaultAssigneeId: uuid("default_assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Last issue number handed out; see `allocate` in services/issues.ts. Never decremented. */
    issueCounter: integer("issue_counter").notNull().default(0),
    /**
     * INC-1: last incident number handed out (`INC-<n>`, per project); see
     * `allocateIncidentNumber` in services/incident-numbers.ts. Never decremented.
     */
    incidentCounter: integer("incident_counter").notNull().default(0),
    sprintLengthDays: integer("sprint_length_days").notNull().default(14),
    /** SPR-5: completing a sprint creates its retro doc from the built-in template. */
    autoRetro: boolean("auto_retro").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check("projects_key_format", sql`${table.key} ~ '^[A-Z]{2,5}$'`),
    check("projects_issue_counter_nonneg", sql`${table.issueCounter} >= 0`),
    check("projects_incident_counter_nonneg", sql`${table.incidentCounter} >= 0`),
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
    /** BRD-5: the board column turns amber above this many issues. Null: no limit. */
    wipLimit: integer("wip_limit"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("statuses_project_name_unique").on(table.projectId, table.name),
    // At most one default per kind per project.
    uniqueIndex("statuses_project_default_unique")
      .on(table.projectId, table.isDefaultFor)
      .where(sql`${table.isDefaultFor} IS NOT NULL`),
    check(
      "statuses_wip_limit_range",
      sql`${table.wipLimit} IS NULL OR ${table.wipLimit} BETWEEN 1 AND 999`,
    ),
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
    /** SPR-5: the retro doc made on completion (`projects.auto_retro`) or linked by hand. */
    retroDocId: uuid("retro_doc_id").references((): AnyPgColumn => docs.id, {
      onDelete: "set null",
    }),
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
    /** REL-1 (P2). */
    description: text("description"),
    releaseDate: date("release_date"),
    state: releaseStateEnum("state").notNull().default("unreleased"),
    /**
     * When it was marked released; set exactly while `state = 'released'` (CHECK). 0005
     * backfills it for rows released before the column existed.
     */
    releasedAt: timestamp("released_at", { withTimezone: true }),
    /** REL-2: the generated release-notes doc. */
    notesDocId: uuid("notes_doc_id").references((): AnyPgColumn => docs.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("releases_project_name_unique").on(table.projectId, table.name),
    check(
      "releases_released_at_state",
      sql`(${table.state} = 'released') = (${table.releasedAt} IS NOT NULL)`,
    ),
  ],
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
    priority: smallint("priority").$type<Priority>().notNull().default(2),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => issues.id, {
      onDelete: "set null",
    }),
    componentId: uuid("component_id").references(() => components.id, { onDelete: "set null" }),
    sprintId: uuid("sprint_id").references(() => sprints.id, { onDelete: "set null" }),
    releaseId: uuid("release_id").references(() => releases.id, { onDelete: "set null" }),
    storyPoints: integer("story_points"),
    /** RDM-1 roadmap bar: an epic runs from `start_date` to `due_date` (its target date). */
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
    // REL-1/2: a release's issues ("Fix version"), and clearing them when it is deleted.
    index("issues_release_idx")
      .on(table.releaseId)
      .where(sql`${table.releaseId} IS NOT NULL`),
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
 * inverse wording is derived when viewed from the target. At most one link of each type per
 * pair of issues in either direction: "A relates B" and "B relates A" are the same link, and
 * "A blocks B" with "B blocks A" (or mutual duplicates) would contradict each other.
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
    uniqueIndex("issue_links_pair_unique").on(
      table.type,
      sql`LEAST(${table.sourceIssueId}, ${table.targetIssueId})`,
      sql`GREATEST(${table.sourceIssueId}, ${table.targetIssueId})`,
    ),
    index("issue_links_source_idx").on(table.sourceIssueId),
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
    /**
     * DOC-13 inline comments (doc comments only, CHECK): the id of the comment mark in the
     * doc JSON (`DOC_COMMENT_ANCHOR_ID_PATTERN`) and the selection quoted when commenting.
     * Null on page-level doc comments (DOC-11) and on issue comments. A reply carries no
     * anchor of its own; it belongs to its `parent_id` thread.
     */
    anchorId: text("anchor_id"),
    anchorText: text("anchor_text"),
    /** DOC-13: resolving a thread hides its mark; set on the thread's top comment. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    /**
     * Thread replies point at the top comment. A composite FK
     * (`comments_parent_same_entity_fk`) makes the parent live on the same entity.
     */
    parentId: uuid("parent_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('english'::regconfig, coalesce("body_text", ''))`,
    ),
    ...timestamps,
  },
  (table) => [
    index("comments_entity_idx").on(table.entityType, table.entityId, table.createdAt),
    index("comments_search_idx").using("gin", table.search),
    // DOC-13: the threads on one mark (and the open marks of a doc).
    index("comments_entity_anchor_idx")
      .on(table.entityType, table.entityId, table.anchorId)
      .where(sql`${table.anchorId} IS NOT NULL`),
    index("comments_parent_idx")
      .on(table.parentId)
      .where(sql`${table.parentId} IS NOT NULL`),
    // Target of the same-entity parent FK below.
    unique("comments_id_entity_unique").on(table.id, table.entityType, table.entityId),
    foreignKey({
      name: "comments_parent_same_entity_fk",
      columns: [table.parentId, table.entityType, table.entityId],
      foreignColumns: [table.id, table.entityType, table.entityId],
    }).onDelete("cascade"),
    // 'doc' has been a comment_entity_type value since 0001, so this CHECK is safe in 0005.
    check(
      "comments_anchor_doc_only",
      sql`(${table.anchorId} IS NULL AND ${table.anchorText} IS NULL) OR ${table.entityType} = 'doc'`,
    ),
    check(
      "comments_anchor_format",
      sql`${table.anchorId} IS NULL OR ${table.anchorId} ~ '^[A-Za-z0-9_-]{1,64}$'`,
    ),
    check(
      "comments_anchor_text_needs_anchor",
      sql`${table.anchorText} IS NULL OR (${table.anchorId} IS NOT NULL AND char_length(${table.anchorText}) <= ${sql.raw(String(DOC_COMMENT_ANCHOR_TEXT_MAX))})`,
    ),
    check(
      "comments_resolved_by_needs_resolved_at",
      sql`${table.resolvedBy} IS NULL OR ${table.resolvedAt} IS NOT NULL`,
    ),
    check("comments_not_own_parent", sql`${table.parentId} IS DISTINCT FROM ${table.id}`),
    // A reply belongs to its thread: the anchor and the resolution live on the top comment.
    check(
      "comments_reply_plain",
      sql`${table.parentId} IS NULL OR (${table.anchorId} IS NULL AND ${table.anchorText} IS NULL AND ${table.resolvedAt} IS NULL)`,
    ),
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
    /**
     * Where an imported doc came from (IMP-1, e.g. `decisions/0004-ocr.md`), so re-running
     * the handbook import updates instead of duplicating. Null for docs written in HQ.
     */
    sourcePath: text("source_path"),
    /**
     * Handbook sync (DOC-12/14, migration 0006). `handbook_path` overrides the repo path
     * (`handbookPathFor`: override → `source_path` → default from the title); `source_path`
     * stays the import's origin. At the last sync (publish merged or pull applied) the file
     * had git blob `handbook_blob_sha` and matched `version = handbook_synced_version`, at
     * `handbook_synced_at` (all three set together). `handbook_remote_sha` is the latest blob
     * seen on the repo's default branch (push webhook / pull), at `handbook_remote_seen_at`;
     * a null sha with a seen-at time means a push changed the file and its blob is not known
     * yet, and `GIT_NULL_SHA` (40 zeros) that it was absent (removed). So: changed in HQ ⇔
     * `version > handbook_synced_version`; changed in the repo ⇔ `handbook_remote_sha IS
     * DISTINCT FROM handbook_blob_sha`; both ⇔ conflict (`lib/handbook/sync-state.ts`).
     */
    handbookPath: text("handbook_path"),
    handbookBlobSha: text("handbook_blob_sha"),
    handbookSyncedVersion: integer("handbook_synced_version"),
    handbookSyncedAt: timestamp("handbook_synced_at", { withTimezone: true }),
    handbookRemoteSha: text("handbook_remote_sha"),
    handbookRemoteSeenAt: timestamp("handbook_remote_seen_at", { withTimezone: true }),
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
    uniqueIndex("docs_project_source_path_unique")
      .on(table.projectId, table.sourcePath)
      .where(sql`${table.sourcePath} IS NOT NULL`),
    index("docs_search_idx").using("gin", table.search),
    check("docs_version_positive", sql`${table.version} > 0`),
    check("docs_not_own_parent", sql`${table.parentId} IS DISTINCT FROM ${table.id}`),
    // Migration 0006 (handbook sync). One live doc per repo file: the override or, failing
    // that, the import's source path (a title-derived default is stored as `handbook_path`
    // when a doc is first published, so it is covered too). Case-insensitive, so two files
    // never collide on a case-insensitive checkout (macOS, Windows).
    uniqueIndex("docs_project_handbook_file_unique")
      .on(table.projectId, sql`lower(coalesce(${table.handbookPath}, ${table.sourcePath}))`)
      .where(
        sql`${table.deletedAt} IS NULL AND coalesce(${table.handbookPath}, ${table.sourcePath}) IS NOT NULL`,
      ),
    check("docs_handbook_path_format", handbookPathCheck(sql`${table.handbookPath}`, true)),
    check(
      "docs_handbook_blob_sha_format",
      sql`${table.handbookBlobSha} IS NULL OR ${table.handbookBlobSha} ~ ${sql.raw(`'${GIT_SHA_REGEX_SOURCE}'`)}`,
    ),
    check(
      "docs_handbook_remote_sha_format",
      sql`${table.handbookRemoteSha} IS NULL OR ${table.handbookRemoteSha} ~ ${sql.raw(`'${GIT_SHA_REGEX_SOURCE}'`)}`,
    ),
    check(
      "docs_handbook_synced_together",
      sql`(${table.handbookBlobSha} IS NULL) = (${table.handbookSyncedVersion} IS NULL)
        AND (${table.handbookBlobSha} IS NULL) = (${table.handbookSyncedAt} IS NULL)`,
    ),
    check(
      "docs_handbook_synced_version_valid",
      sql`${table.handbookSyncedVersion} IS NULL OR ${table.handbookSyncedVersion} BETWEEN 1 AND ${table.version}`,
    ),
    check(
      "docs_handbook_remote_sha_seen",
      sql`${table.handbookRemoteSha} IS NULL OR ${table.handbookRemoteSeenAt} IS NOT NULL`,
    ),
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

/**
 * MY-1 "recently viewed" (not in SPEC §8's table list, added so the My Work slice needs no
 * migration). One row per user and item, upserted with a new `viewed_at` on each visit.
 */
export const recentViews = pgTable(
  "recent_views",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: entityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.entityType, table.entityId] }),
    index("recent_views_user_viewed_idx").on(table.userId, table.viewedAt.desc()),
  ],
);

// ── GitHub integration (GH-1…GH-4) ───────────────────────────────────────────────────────

export const githubRefKindEnum = pgEnum("github_ref_kind", GITHUB_REF_KINDS);
export const githubPrStateEnum = pgEnum("github_pr_state", GITHUB_PR_STATES);

/**
 * A branch, pull request or commit that mentions an issue key (GH-2), one row per issue it
 * mentions. Written only by the signature-verified webhook. The partial unique indexes make
 * a redelivered or repeated event an upsert of the same row, never a duplicate.
 */
export const githubRefs = pgTable(
  "github_refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    /** `Owner/repo`, e.g. `Stockkart/inventory-api`. */
    repo: text("repo").notNull(),
    kind: githubRefKindEnum("kind").notNull(),
    /** PR number (kind `pr`). */
    number: integer("number"),
    /** Commit sha (kind `commit`). */
    sha: text("sha"),
    /** Branch name (kind `branch`; the head branch for a PR). */
    refName: text("ref_name"),
    /** PR title or the commit message's first line; the branch name for branches. */
    title: text("title").notNull(),
    url: text("url").notNull(),
    /** PRs only; null for branches and commits. */
    state: githubPrStateEnum("state"),
    authorLogin: text("author_login"),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    /**
     * PRs: `pull_request.updated_at` of the event that last wrote the row. GitHub does not
     * deliver in order, so an older event never overwrites a newer state.
     */
    githubUpdatedAt: timestamp("github_updated_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("github_refs_issue_idx").on(table.issueId),
    uniqueIndex("github_refs_pr_unique")
      .on(table.issueId, table.repo, table.kind, table.number)
      .where(sql`${table.kind} = 'pr'`),
    uniqueIndex("github_refs_commit_unique")
      .on(table.issueId, table.repo, table.kind, table.sha)
      .where(sql`${table.kind} = 'commit'`),
    uniqueIndex("github_refs_branch_unique")
      .on(table.issueId, table.repo, table.kind, table.refName)
      .where(sql`${table.kind} = 'branch'`),
    // Every PR state change updates all rows of that PR, whichever issues it links.
    index("github_refs_pr_idx")
      .on(table.repo, table.number)
      .where(sql`${table.kind} = 'pr'`),
    check(
      "github_refs_kind_columns",
      sql`(${table.kind} = 'pr' AND ${table.number} IS NOT NULL AND ${table.state} IS NOT NULL)
        OR (${table.kind} = 'commit' AND ${table.sha} IS NOT NULL AND ${table.state} IS NULL)
        OR (${table.kind} = 'branch' AND ${table.refName} IS NOT NULL AND ${table.state} IS NULL)`,
    ),
  ],
);

/**
 * Webhook deliveries already applied, keyed by `X-GitHub-Delivery`, so a redelivery changes
 * nothing (GH-1). Rows older than 30 days are pruned by the webhook itself; GitHub only
 * offers redelivery of recent deliveries. Not in SPEC §8's list; append-only, so no
 * `id`/`updated_at`.
 */
export const githubDeliveries = pgTable(
  "github_deliveries",
  {
    deliveryId: text("delivery_id").primaryKey(),
    event: text("event").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("github_deliveries_received_idx").on(table.receivedAt)],
);

/**
 * GH-3 runs once per merged PR: the webhook inserts (repo, number) here in the statement
 * that closes the PR's issues, and closes nothing when the row already exists. So a replayed
 * or redelivered merge (the delivery id is not signed) never re-closes an issue someone
 * reopened, whatever order the PR's other events arrived in. Not in SPEC §8's list; one row
 * per merged PR with closing keywords, so no `id`/`updated_at`.
 */
export const githubPrMerges = pgTable(
  "github_pr_merges",
  {
    repo: text("repo").notNull(),
    number: integer("number").notNull(),
    createdAt,
  },
  (table) => [primaryKey({ columns: [table.repo, table.number] })],
);

// ── Phase 2 (P1) foundation, migration 0004 ──────────────────────────────────────────────

/**
 * ISS-11 watchers. The assignee and reporter are added automatically by the issue writes;
 * anyone can watch or unwatch by hand. A join table, so no `id`/`updated_at`.
 */
export const watchers = pgTable(
  "watchers",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.issueId, table.userId] }),
    index("watchers_user_idx").on(table.userId),
  ],
);

/**
 * NTF-1 in-app notifications, one row per recipient and event. `entity_type`/`entity_id`
 * point at what to open (no FK: polymorphic). Only `read_at` ever changes, so there is no
 * `updated_at`. `dedupe_key` (e.g. `assigned:<issueId>:<activityId>`) makes a retried write
 * an `ON CONFLICT DO NOTHING` instead of a second bell entry; null when no dedupe is needed.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    entityType: entityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    /** Who caused it; null for system/GitHub events. */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    readAt: timestamp("read_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key").unique("notifications_dedupe_key_unique"),
    createdAt,
  },
  (table) => [
    // The bell: a user's unread first, newest first.
    index("notifications_user_read_created_idx").on(
      table.userId,
      table.readAt,
      table.createdAt.desc(),
    ),
    // "All notifications", read and unread together, newest first.
    index("notifications_user_created_idx").on(table.userId, table.createdAt.desc()),
  ],
);

/**
 * VW-3 saved views: a named issue filter (the same shape as the URL filter, VW-2), personal
 * or `shared` with everyone in the project. Ordered per user by a fractional key.
 */
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filter: jsonb("filter").$type<Record<string, unknown>>().notNull(),
    shared: boolean("shared").notNull().default(false),
    position: fractionalKey("position").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("saved_views_user_project_name_unique").on(
      table.userId,
      table.projectId,
      table.name,
    ),
    index("saved_views_project_shared_idx")
      .on(table.projectId)
      .where(sql`${table.shared}`),
  ],
);

/**
 * ISS-9 / DOC-1 files in the private R2 bucket (S-5). The object lives at `storage_key`
 * (`attachments/<uuid>/<sanitized-filename>`); it is only ever served through
 * `/api/files/[id]` as a short-lived presigned URL, and only once `status = 'ready'`.
 * Soft delete never removes the object (§9.3; a purge job is P2).
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: attachmentEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    storageKey: text("storage_key").notNull().unique("attachments_storage_key_unique"),
    /** The original name, shown to people and sent in Content-Disposition (sanitized). */
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Images only. */
    width: integer("width"),
    height: integer("height"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    status: attachmentStatusEnum("status").notNull().default("pending"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("attachments_entity_idx").on(table.entityType, table.entityId),
    // Stale pending uploads (abandoned presigned PUTs) are found for cleanup by age.
    index("attachments_pending_created_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    check(
      "attachments_size_range",
      sql`${table.sizeBytes} BETWEEN 1 AND ${sql.raw(String(MAX_ATTACHMENT_BYTES))}`,
    ),
    check(
      "attachments_dimensions_positive",
      sql`(${table.width} IS NULL OR ${table.width} > 0) AND (${table.height} IS NULL OR ${table.height} > 0)`,
    ),
    // The `attachmentKey` layout only (server/storage/keys.ts), so a row can never point the
    // download route at `backups/` or `tmp/`. The storage module checks it again.
    check(
      "attachments_storage_key_layout",
      sql`${table.storageKey} ~ '^attachments/[0-9a-f-]{36}/[A-Za-z0-9-][A-Za-z0-9._-]{0,99}$'`,
    ),
  ],
);

/**
 * DGM-1…7 whiteboards (Excalidraw scene JSON) and flows (`{ nodes, edges, viewport }`).
 * `scene_text` holds the labels, derived on the server, for search. Optimistic locking like
 * docs (§7.4). The scene is bounded by a CHECK (see `DIAGRAM_SCENE_MAX_BYTES`); embedded
 * images are R2 attachments, never inline data URLs.
 */
export const diagrams = pgTable(
  "diagrams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    kind: diagramKindEnum("kind").notNull(),
    title: text("title").notNull(),
    scene: jsonb("scene").$type<Record<string, unknown>>().notNull(),
    sceneText: text("scene_text").notNull().default(""),
    /** DGM-5: `thumbnails/diagrams/<id>.png` in R2, served by an authed route. */
    thumbnailKey: text("thumbnail_key"),
    /** Optimistic locking (§7.4): `UPDATE … WHERE version = base`. */
    version: integer("version").notNull().default(1),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    templateId: uuid("template_id").references(() => templates.id, { onDelete: "set null" }),
    /** List order per project; a fractional key like `docs.position`. */
    position: fractionalKey("position").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // A tsvector is capped at 1 MB, so only the first 200 000 characters of the labels are
    // indexed; a huge scene can never make its own save fail.
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('english'::regconfig, coalesce("title", '')), 'A') || setweight(to_tsvector('english'::regconfig, left(coalesce("scene_text", ''), 200000)), 'B')`,
    ),
    ...timestamps,
  },
  (table) => [
    index("diagrams_project_position_idx").on(table.projectId, table.position),
    index("diagrams_search_idx").using("gin", table.search),
    check("diagrams_version_positive", sql`${table.version} > 0`),
    check(
      "diagrams_scene_size",
      sql`octet_length(${table.scene}::text) < ${sql.raw(String(DIAGRAM_SCENE_MAX_BYTES))}`,
    ),
    // The `diagramThumbnailKey` layout only (see `attachments_storage_key_layout`).
    check(
      "diagrams_thumbnail_key_layout",
      sql`${table.thumbnailKey} IS NULL OR ${table.thumbnailKey} ~ '^thumbnails/diagrams/[0-9a-f-]{36}[.]png$'`,
    ),
  ],
);

/** DGM-4 full snapshot per saved version (§7.3). Immutable, so no `updated_at`. */
export const diagramVersions = pgTable(
  "diagram_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    diagramId: uuid("diagram_id")
      .notNull()
      .references(() => diagrams.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    scene: jsonb("scene").$type<Record<string, unknown>>().notNull(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    createdAt,
  },
  (table) => [
    uniqueIndex("diagram_versions_diagram_version_unique").on(table.diagramId, table.version),
    check("diagram_versions_version_positive", sql`${table.version} > 0`),
    check(
      "diagram_versions_scene_size",
      sql`octet_length(${table.scene}::text) < ${sql.raw(String(DIAGRAM_SCENE_MAX_BYTES))}`,
    ),
  ],
);

// ── Phase 3 (P2) foundation, migration 0005 ──────────────────────────────────────────────

/**
 * SVC-1 service registry: where each service runs and where to look (app, logs, dashboards,
 * DB console). `environments` and `links` are JSON arrays (CHECK); every URL in them is
 * validated with `parseSafeUrl` (`lib/links/safe-url.ts`) before it is written.
 *
 * NEVER store credentials in this table: there is deliberately no secrets column, and no
 * password, token, API key or connection string may go into `notes`, `description` or a URL
 * (SPEC §4.14 "No secrets", S-6). Secrets live only in the platforms' own env settings.
 *
 * The slug stays taken while a service is soft-deleted, so restoring it never conflicts.
 */
export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** URL key, e.g. `inventory-api` (`SERVICE_SLUG_PATTERN`). */
    slug: text("slug").notNull(),
    description: text("description"),
    /** `Owner/repo`, e.g. `Stockkart/inventory-api`. */
    repo: text("repo"),
    /** Runtime / host, e.g. "DigitalOcean App Platform" or "Vercel". */
    runtime: text("runtime"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    environments: jsonb("environments")
      .$type<ServiceEnvironment[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    links: jsonb("links")
      .$type<ServiceLink[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    notes: text("notes"),
    /** List order per project; a fractional key like `docs.position`. */
    position: fractionalKey("position").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("services_project_slug_unique").on(table.projectId, table.slug),
    index("services_project_position_idx").on(table.projectId, table.position),
    check(
      "services_slug_format",
      sql`char_length(${table.slug}) <= ${sql.raw(String(SERVICE_SLUG_MAX))} AND ${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check(
      "services_repo_format",
      sql`${table.repo} IS NULL OR ${table.repo} ~ '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$'`,
    ),
    check(
      "services_json_arrays",
      sql`jsonb_typeof(${table.environments}) = 'array' AND jsonb_typeof(${table.links}) = 'array'
        AND jsonb_array_length(${table.environments}) <= ${sql.raw(String(SERVICE_MAX_ENVIRONMENTS))}
        AND jsonb_array_length(${table.links}) <= ${sql.raw(String(SERVICE_MAX_LINKS))}`,
    ),
  ],
);

/**
 * INC-1 incidents, numbered per project like issues (`INC-<n>`, from
 * `projects.incident_counter`; `allocateIncidentNumber`). Follow-up issues (INC-2) are
 * `entity_links` rows (`incident` → `issue`); the postmortem is `postmortem_doc_id`.
 * `resolved_at` is set exactly while `status = 'resolved'`.
 */
export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    severity: incidentSeverityEnum("severity").notNull(),
    status: incidentStatusEnum("status").notNull().default("investigating"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    mitigatedAt: timestamp("mitigated_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    commanderId: uuid("commander_id").references(() => users.id, { onDelete: "set null" }),
    /** Plain text; feeds `search`. */
    summary: text("summary").notNull().default(""),
    postmortemDocId: uuid("postmortem_doc_id").references(() => docs.id, {
      onDelete: "set null",
    }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('english'::regconfig, coalesce("title", '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce("summary", '')), 'B')`,
    ),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("incidents_project_number_unique").on(table.projectId, table.number),
    index("incidents_project_started_idx").on(table.projectId, table.startedAt.desc()),
    index("incidents_search_idx").using("gin", table.search),
    check("incidents_number_positive", sql`${table.number} > 0`),
    check(
      "incidents_title_length",
      sql`char_length(${table.title}) BETWEEN 1 AND ${sql.raw(String(INCIDENT_TITLE_MAX))}`,
    ),
    check(
      "incidents_resolved_at_status",
      sql`(${table.status} = 'resolved') = (${table.resolvedAt} IS NOT NULL)`,
    ),
    // Mitigated means "when" is known; an incident may go straight to resolved, though.
    check(
      "incidents_mitigated_at_status",
      sql`${table.status} <> 'mitigated' OR ${table.mitigatedAt} IS NOT NULL`,
    ),
    check(
      "incidents_times_ordered",
      sql`(${table.mitigatedAt} IS NULL OR ${table.mitigatedAt} >= ${table.startedAt})
        AND (${table.resolvedAt} IS NULL
          OR ${table.resolvedAt} >= coalesce(${table.mitigatedAt}, ${table.startedAt}))`,
    ),
  ],
);

/** INC-1 affected services. A join table, so no `id`/`updated_at`. */
export const incidentServices = pgTable(
  "incident_services",
  {
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.incidentId, table.serviceId] }),
    index("incident_services_service_idx").on(table.serviceId),
  ],
);

/**
 * INC-1 timeline notes, in `at` order (when it happened, which may be before it was
 * written). Append-only, so no `updated_at`.
 */
export const incidentTimeline = pgTable(
  "incident_timeline",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    kind: incidentTimelineKindEnum("kind").notNull(),
    body: text("body").notNull(),
    createdAt,
  },
  (table) => [
    index("incident_timeline_incident_at_idx").on(table.incidentId, table.at),
    check(
      "incident_timeline_body_length",
      sql`char_length(${table.body}) BETWEEN 1 AND ${sql.raw(String(INCIDENT_TIMELINE_BODY_MAX))}`,
    ),
  ],
);

/**
 * NTF-2 digest sends, one row per user, kind and period: inserting the `pending` row first
 * (`ON CONFLICT DO NOTHING`) claims the period, so a retried or overlapping cron run never
 * emails twice. Derive each `period_start` from `users.last_digest_at` (not from the
 * calendar), so changing the frequency never produces overlapping periods. Holds no email
 * content or address; `error_code` is a short provider code.
 */
export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: emailDeliveryKindEnum("kind").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    /** Set exactly when `status = 'sent'`. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** The provider's message id (Resend), for support lookups. */
    providerId: text("provider_id"),
    status: emailDeliveryStatusEnum("status").notNull().default("pending"),
    errorCode: text("error_code"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("email_deliveries_user_kind_period_unique").on(
      table.userId,
      table.kind,
      table.periodStart,
    ),
    check("email_deliveries_period_order", sql`${table.periodEnd} > ${table.periodStart}`),
    check(
      "email_deliveries_sent_at_status",
      sql`(${table.status} = 'sent') = (${table.sentAt} IS NOT NULL)`,
    ),
    check(
      "email_deliveries_error_code",
      sql`${table.errorCode} IS NULL OR (${table.status} = 'failed' AND char_length(${table.errorCode}) <= ${sql.raw(String(EMAIL_ERROR_CODE_MAX))})`,
    ),
  ],
);

/**
 * IMP-4 CSV imports of issues: one row per upload, `previewed` → `applied` | `failed`. It
 * records the history and makes apply idempotent (`UPDATE … WHERE status = 'previewed'` in
 * the statement that creates the issues). The raw CSV is never stored; `report` holds the
 * per-row outcome (bounded by a CHECK). Written twice at most, so no `updated_at`.
 */
export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: importKindEnum("kind").notNull(),
    filename: text("filename").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    status: importStatusEnum("status").notNull().default("previewed"),
    rowCount: integer("row_count").notNull().default(0),
    createdCount: integer("created_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    report: jsonb("report")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt,
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (table) => [
    index("imports_project_created_idx").on(table.projectId, table.createdAt.desc()),
    check(
      "imports_counts_valid",
      sql`${table.rowCount} >= 0 AND ${table.createdCount} >= 0 AND ${table.errorCount} >= 0
        AND ${table.createdCount} + ${table.errorCount} <= ${table.rowCount}`,
    ),
    check(
      "imports_applied_at_status",
      sql`(${table.status} = 'applied') = (${table.appliedAt} IS NOT NULL)`,
    ),
    check(
      "imports_filename_length",
      sql`char_length(${table.filename}) BETWEEN 1 AND ${sql.raw(String(IMPORT_FILENAME_MAX))}`,
    ),
    check(
      "imports_report_size",
      sql`octet_length(${table.report}::text) < ${sql.raw(String(IMPORT_REPORT_MAX_BYTES))}`,
    ),
  ],
);

// ── Handbook sync (DOC-12, DOC-14; migration 0006) ──────────────────────────────────────

/**
 * A pull request HQ opened on `Stockkart/engineering-handbook` through its GitHub App
 * (DOC-14): branch `hq/…` (CHECK), `open` → `merged` | `closed`, or `failed` before or while
 * opening it (`error_code`, a short machine code; never a token or a response body).
 * `is_open` is generated from `state` and referenced by `handbook_publication_docs`, which is
 * how "one open publication per doc" stays true without a trigger (see there).
 */
export const handbookPublications = pgTable(
  "handbook_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    branch: text("branch").notNull(),
    prNumber: integer("pr_number"),
    prUrl: text("pr_url"),
    state: handbookPublicationStateEnum("state").notNull().default("open"),
    isOpen: boolean("is_open")
      .notNull()
      .generatedAlwaysAs(sql`state = 'open'`),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    /** Set exactly while `state = 'merged'`. */
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    errorCode: text("error_code"),
  },
  (table) => [
    uniqueIndex("handbook_publications_project_branch_unique").on(table.projectId, table.branch),
    uniqueIndex("handbook_publications_project_pr_unique")
      .on(table.projectId, table.prNumber)
      .where(sql`${table.prNumber} IS NOT NULL`),
    index("handbook_publications_project_created_idx").on(table.projectId, table.createdAt.desc()),
    // Target of the composite FK below (Postgres needs a unique key on exactly those columns).
    unique("handbook_publications_id_open_unique").on(table.id, table.isOpen),
    check(
      "handbook_publications_branch_format",
      sql`${table.branch} ~ ${sql.raw(`'${HANDBOOK_BRANCH_REGEX_SOURCE}'`)}
        AND strpos(${table.branch}, '..') = 0 AND ${table.branch} NOT LIKE '%.lock'`,
    ),
    check(
      "handbook_publications_pr_number_positive",
      sql`${table.prNumber} IS NULL OR ${table.prNumber} > 0`,
    ),
    check(
      "handbook_publications_pr_url_format",
      sql`${table.prUrl} IS NULL OR ${table.prUrl} ~ ${sql.raw(`'${HANDBOOK_PR_URL_REGEX_SOURCE}'`)}`,
    ),
    check(
      "handbook_publications_pr_together",
      sql`(${table.prNumber} IS NULL) = (${table.prUrl} IS NULL)`,
    ),
    check(
      "handbook_publications_merged_at_state",
      sql`(${table.state} = 'merged') = (${table.mergedAt} IS NOT NULL)`,
    ),
    check(
      "handbook_publications_merged_has_pr",
      sql`${table.state} NOT IN ('merged', 'closed') OR ${table.prNumber} IS NOT NULL`,
    ),
    check(
      "handbook_publications_error_code",
      sql`${table.errorCode} IS NULL OR (${table.state} = 'failed'
        AND ${table.errorCode} ~ ${sql.raw(`'${HANDBOOK_ERROR_CODE_REGEX_SOURCE}'`)})`,
    ),
  ],
);

/**
 * The docs of one publication: the repo `path` written, the `doc_version` exported and the
 * resulting git `blob_sha` (known once the commit exists). Written once per doc, so no
 * `updated_at`.
 *
 * "At most one OPEN publication per doc" is the partial unique index on `doc_id WHERE open`.
 * A partial index cannot look at another table, so `open` is a copy of the publication's
 * generated `is_open`, kept equal by the composite FK `(publication_id, open)` →
 * `handbook_publications (id, is_open)` with `ON UPDATE CASCADE`: changing a publication's
 * `state` recomputes `is_open`, and Postgres cascades it into these rows in the same
 * statement. So no trigger, no app-side bookkeeping, and the copy cannot drift (inserting a
 * row with the wrong `open` fails the FK). Reopening a closed publication while another one
 * is open for the same doc fails on the index, as it should.
 */
export const handbookPublicationDocs = pgTable(
  "handbook_publication_docs",
  {
    publicationId: uuid("publication_id").notNull(),
    docId: uuid("doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    docVersion: integer("doc_version").notNull(),
    blobSha: text("blob_sha"),
    open: boolean("open").notNull().default(true),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.publicationId, table.docId] }),
    foreignKey({
      name: "handbook_publication_docs_publication_open_fk",
      columns: [table.publicationId, table.open],
      foreignColumns: [handbookPublications.id, handbookPublications.isOpen],
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
    uniqueIndex("handbook_publication_docs_one_open_per_doc")
      .on(table.docId)
      .where(sql`${table.open}`),
    // A doc's publication history (the doc page's sync status).
    index("handbook_publication_docs_doc_idx").on(table.docId),
    // One file per path in a PR. (Doc and publication in the same project is the app's
    // check, as for incident_services.)
    uniqueIndex("handbook_publication_docs_publication_path_unique").on(
      table.publicationId,
      sql`lower(${table.path})`,
    ),
    check("handbook_publication_docs_path_format", handbookPathCheck(sql`${table.path}`, false)),
    check("handbook_publication_docs_version_positive", sql`${table.docVersion} > 0`),
    check(
      "handbook_publication_docs_blob_sha_format",
      sql`${table.blobSha} IS NULL OR ${table.blobSha} ~ ${sql.raw(`'${GIT_SHA_REGEX_SOURCE}'`)}`,
    ),
  ],
);

// ── Costs (IMR): migration 0007 ──────────────────────────────────────────────────────────

/** CHECK body: an ISO currency we support (`COST_CURRENCIES`). */
const currencyCheck = (column: SQL) => sql`${column} IN ('INR', 'USD')`;
/** CHECK body: minor units in 0…MAX_AMOUNT_MINOR (nullable columns pass NULL). */
const amountCheck = (column: SQL) =>
  sql`${column} >= 0 AND ${column} <= ${sql.raw(String(MAX_AMOUNT_MINOR))}`;

/**
 * COST-1 cost items: what Stockkart pays for (a vendor plan, a usage bill, the domain).
 * Money is integer minor units (paise / cents) in `bigint` columns, never a float.
 * `active = false` is "archived": no longer expected, but its entries still count. Names
 * are unique per project (case-insensitive) among live items, which also makes "Add
 * Stockkart defaults" idempotent by name. Activity uses `entity_type = 'cost_item'`.
 */
export const costItems = pgTable(
  "cost_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    vendor: text("vendor"),
    category: costCategoryEnum("category").notNull(),
    /** The service-registry entry it pays for, if any (SVC-1). */
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    billingCycle: billingCycleEnum("billing_cycle").notNull(),
    currency: text("currency").notNull(),
    expectedAmountMinor: bigint("expected_amount_minor", { mode: "number" }),
    /** Next (or usual) renewal; a yearly item is due in this date's month every year. */
    renewsOn: date("renews_on"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    /** List order per project; a fractional key like `services.position`. */
    position: fractionalKey("position").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("cost_items_project_name_unique")
      .on(table.projectId, sql`lower(${table.name})`)
      .where(sql`${table.deletedAt} IS NULL`),
    index("cost_items_project_position_idx").on(table.projectId, table.position),
    index("cost_items_service_idx").on(table.serviceId),
    check(
      "cost_items_name_length",
      sql`char_length(${table.name}) BETWEEN 1 AND ${sql.raw(String(COST_NAME_MAX))}`,
    ),
    check("cost_items_currency", currencyCheck(sql`${table.currency}`)),
    check(
      "cost_items_expected_amount",
      sql`${table.expectedAmountMinor} IS NULL OR (${amountCheck(sql`${table.expectedAmountMinor}`)})`,
    ),
  ],
);

/**
 * COST-2 one amount per item and month. `period` is the first day of the month (CHECK).
 * `base_amount_minor` is the amount in the project's base currency at the entry's own
 * `fx_rate_to_base` (stored per entry and editable; never fetched): with no rate the
 * entry is in the base currency, so both amounts are equal (CHECK). The app requires a
 * rate whenever `currency` differs from the base currency (a CHECK cannot see
 * `cost_settings`). A `no_charge` month has amount 0 (CHECK).
 */
export const costEntries = pgTable(
  "cost_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => costItems.id, { onDelete: "cascade" }),
    period: date("period").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    fxRateToBase: numeric("fx_rate_to_base", { precision: 12, scale: 6 }),
    baseAmountMinor: bigint("base_amount_minor", { mode: "number" }).notNull(),
    kind: costEntryKindEnum("kind").notNull(),
    notes: text("notes"),
    enteredBy: uuid("entered_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("cost_entries_item_period_unique").on(table.itemId, table.period),
    // The month and year tabs read entries by period range (joined to the project's items).
    index("cost_entries_period_idx").on(table.period),
    check("cost_entries_period_first_day", sql`extract(day from ${table.period}) = 1`),
    check("cost_entries_amount", amountCheck(sql`${table.amountMinor}`)),
    check("cost_entries_base_amount", amountCheck(sql`${table.baseAmountMinor}`)),
    check("cost_entries_currency", currencyCheck(sql`${table.currency}`)),
    check("cost_entries_fx_rate", sql`${table.fxRateToBase} IS NULL OR ${table.fxRateToBase} > 0`),
    check(
      "cost_entries_base_without_rate",
      sql`${table.fxRateToBase} IS NOT NULL OR ${table.baseAmountMinor} = ${table.amountMinor}`,
    ),
    check(
      "cost_entries_no_charge_zero",
      sql`${table.kind} <> 'no_charge' OR ${table.amountMinor} = 0`,
    ),
  ],
);

/**
 * COST-8 per-project costs settings (one row, created on the first save; until then the
 * defaults apply). `reminder_user_ids` empty means "the project lead" (COST-7); ids of
 * users deleted since are ignored by the reader. `default_usd_to_inr` only pre-fills new
 * entries' rates. The base currency cannot change once entries exist (their base amounts
 * would mean something else): the settings write refuses it in its own statement.
 */
export const costSettings = pgTable(
  "cost_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .unique("cost_settings_project_unique")
      .references(() => projects.id, { onDelete: "cascade" }),
    baseCurrency: text("base_currency").notNull().default(DEFAULT_BASE_CURRENCY),
    monthlyBudgetMinor: bigint("monthly_budget_minor", { mode: "number" }),
    reminderDay: integer("reminder_day").notNull().default(DEFAULT_REMINDER_DAY),
    reminderUserIds: uuid("reminder_user_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    defaultUsdToInr: numeric("default_usd_to_inr", { precision: 12, scale: 6 }),
    ...timestamps,
  },
  (table) => [
    check("cost_settings_base_currency", currencyCheck(sql`${table.baseCurrency}`)),
    check(
      "cost_settings_budget",
      sql`${table.monthlyBudgetMinor} IS NULL OR (${amountCheck(sql`${table.monthlyBudgetMinor}`)})`,
    ),
    check(
      "cost_settings_reminder_day",
      sql`${table.reminderDay} BETWEEN ${sql.raw(String(REMINDER_DAY_MIN))} AND ${sql.raw(String(REMINDER_DAY_MAX))}`,
    ),
    check(
      "cost_settings_usd_to_inr",
      sql`${table.defaultUsdToInr} IS NULL OR ${table.defaultUsdToInr} > 0`,
    ),
    check("cost_settings_reminder_users", sql`cardinality(${table.reminderUserIds}) <= 50`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type StatusRow = typeof statuses.$inferSelect;
export type IssueRow = typeof issues.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type ActivityRow = typeof activity.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type SavedViewRow = typeof savedViews.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type DiagramRow = typeof diagrams.$inferSelect;
export type ServiceRow = typeof services.$inferSelect;
export type IncidentRow = typeof incidents.$inferSelect;
export type IncidentTimelineRow = typeof incidentTimeline.$inferSelect;
export type EmailDeliveryRow = typeof emailDeliveries.$inferSelect;
export type ImportRow = typeof imports.$inferSelect;
export type ReleaseRow = typeof releases.$inferSelect;
export type HandbookPublicationRow = typeof handbookPublications.$inferSelect;
export type HandbookPublicationDocRow = typeof handbookPublicationDocs.$inferSelect;
export type CostItemRow = typeof costItems.$inferSelect;
export type CostEntryRow = typeof costEntries.$inferSelect;
export type CostSettingsRow = typeof costSettings.$inferSelect;
