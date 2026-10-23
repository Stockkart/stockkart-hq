import { and, asc, desc, eq, exists, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { alias as pgAlias } from "drizzle-orm/pg-core";

import { ISSUE_TYPES, type IssueType } from "@/lib/issues/constants";
import { formatIssueKey } from "@/lib/issues/keys";
import { viewLink } from "@/lib/issues/links";
import {
  type ActivityView,
  type ChildIssue,
  type IssueDetail,
  type IssueListItem,
  type IssueSummary,
  type LinkView,
  type MentionView,
  type ProjectMeta,
} from "@/lib/issues/views";
import { type RichTextDoc } from "@/lib/rich-text";
import { directRead, type Read } from "@/server/db/read-batch";
import {
  activity,
  comments,
  components,
  entityLinks,
  issueLinks,
  issues,
  labels,
  projects,
  releases,
  sprints,
  statuses,
  templates,
  users,
} from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

import { type IdRef, labelsJson, parseLabels } from "./sql";

export interface QueryOptions {
  /** How reads run; on Neon, reads started together share one round trip (`read-batch`). */
  read?: Read;
}

/**
 * Read side for the issue pages. Every query skips soft-deleted issues.
 *
 * Ids may be `IdRef` subqueries (`projectIdByKey`, `issueIdByNumber`), so a page can load
 * everything in one batch without first resolving the project or the issue. Every query is
 * a single statement: nothing waits on an earlier query's result.
 */
export function createIssueQueries(db: AppDatabase, { read = directRead }: QueryOptions = {}) {
  const summaryColumns = {
    id: issues.id,
    number: issues.number,
    title: issues.title,
    type: issues.type,
    projectKey: projects.key,
  };
  const toSummary = (row: {
    id: string;
    number: number;
    title: string;
    type: IssueType;
    projectKey: string;
  }): IssueSummary => ({
    id: row.id,
    key: formatIssueKey(row.projectKey, row.number),
    title: row.title,
    type: row.type,
  });

  const childColumns = {
    ...summaryColumns,
    priority: issues.priority,
    statusId: statuses.id,
    statusName: statuses.name,
    statusCategory: statuses.category,
  };
  const toChild = (row: {
    id: string;
    number: number;
    title: string;
    type: IssueType;
    projectKey: string;
    priority: ChildIssue["priority"];
    statusId: string;
    statusName: string;
    statusCategory: ChildIssue["status"]["category"];
  }): ChildIssue => ({
    ...toSummary(row),
    priority: row.priority,
    status: { id: row.statusId, name: row.statusName, category: row.statusCategory },
  });

  return {
    async getProject(key: string) {
      const [project] = await read(
        db
          .select({
            id: projects.id,
            key: projects.key,
            name: projects.name,
            // SPR-1: the default length of a new sprint.
            sprintLengthDays: projects.sprintLengthDays,
          })
          .from(projects)
          .where(and(eq(projects.key, key), isNull(projects.archivedAt)))
          .limit(1),
      );
      return project ?? null;
    },

    async listProjectKeys(): Promise<string[]> {
      const rows = await read(db.select({ key: projects.key }).from(projects));
      return rows.map((row) => row.key);
    },

    /** Issue list (§4.10 basic form): newest first. Filters arrive with VW-1. */
    async listIssues(projectId: IdRef): Promise<IssueListItem[]> {
      const rows = await read(
        db
          .select({
            ...summaryColumns,
            priority: issues.priority,
            statusId: statuses.id,
            statusName: statuses.name,
            statusCategory: statuses.category,
            assigneeId: users.id,
            assigneeName: users.name,
          })
          .from(issues)
          .innerJoin(projects, eq(projects.id, issues.projectId))
          .innerJoin(statuses, eq(statuses.id, issues.statusId))
          .leftJoin(users, eq(users.id, issues.assigneeId))
          .where(and(eq(issues.projectId, projectId), isNull(issues.deletedAt)))
          .orderBy(desc(issues.number)),
      );
      return rows.map((row) => ({
        ...toSummary(row),
        number: row.number,
        priority: row.priority,
        status: { id: row.statusId, name: row.statusName, category: row.statusCategory },
        assignee:
          row.assigneeId && row.assigneeName
            ? { id: row.assigneeId, name: row.assigneeName }
            : null,
      }));
    },

    /** The issue with its labels (one statement: the labels are a json column). */
    async getIssue(projectId: IdRef, number: number): Promise<IssueDetail | null> {
      const reporter = pgAlias(users, "reporter");
      const parent = pgAlias(issues, "parent");
      const [row] = await read(
        db
          .select({
            issue: {
              id: issues.id,
              number: issues.number,
              projectId: issues.projectId,
              title: issues.title,
              type: issues.type,
              description: issues.description,
              statusId: issues.statusId,
              priority: issues.priority,
              assigneeId: issues.assigneeId,
              componentId: issues.componentId,
              storyPoints: issues.storyPoints,
              dueDate: issues.dueDate,
              sprintId: issues.sprintId,
              releaseId: issues.releaseId,
              createdAt: issues.createdAt,
              updatedAt: issues.updatedAt,
              resolvedAt: issues.resolvedAt,
            },
            projectKey: projects.key,
            reporterId: reporter.id,
            reporterName: reporter.name,
            parentId: parent.id,
            parentNumber: parent.number,
            parentTitle: parent.title,
            parentType: parent.type,
            labels: labelsJson(issues.id),
          })
          .from(issues)
          .innerJoin(projects, eq(projects.id, issues.projectId))
          .leftJoin(reporter, eq(reporter.id, issues.reporterId))
          .leftJoin(parent, and(eq(parent.id, issues.parentId), isNull(parent.deletedAt)))
          .where(
            and(
              eq(issues.projectId, projectId),
              eq(issues.number, number),
              isNull(issues.deletedAt),
            ),
          )
          .limit(1),
      );
      if (!row) return null;
      const { issue } = row;
      return {
        id: issue.id,
        number: issue.number,
        key: formatIssueKey(row.projectKey, issue.number),
        projectId: issue.projectId,
        projectKey: row.projectKey,
        title: issue.title,
        type: issue.type,
        description: issue.description,
        statusId: issue.statusId,
        priority: issue.priority,
        assigneeId: issue.assigneeId,
        reporter:
          row.reporterId && row.reporterName
            ? { id: row.reporterId, name: row.reporterName }
            : null,
        componentId: issue.componentId,
        parent:
          row.parentId && row.parentNumber !== null && row.parentTitle !== null && row.parentType
            ? {
                id: row.parentId,
                key: formatIssueKey(row.projectKey, row.parentNumber),
                title: row.parentTitle,
                type: row.parentType,
              }
            : null,
        storyPoints: issue.storyPoints,
        dueDate: issue.dueDate,
        sprintId: issue.sprintId,
        releaseId: issue.releaseId,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        resolvedAt: issue.resolvedAt,
        labels: parseLabels(row.labels),
      };
    },

    /**
     * Side-panel options: statuses, components, labels, every HQ user, epics, open sprints
     * and the fix-version picker's releases (REL-1).
     */
    async getProjectMeta(projectId: IdRef): Promise<ProjectMeta> {
      const [statusRows, componentRows, labelRows, userRows, epicRows, sprintRows, releaseRows] =
        await Promise.all([
          read(
            db
              .select({
                id: statuses.id,
                name: statuses.name,
                category: statuses.category,
                wipLimit: statuses.wipLimit,
              })
              .from(statuses)
              .where(eq(statuses.projectId, projectId))
              .orderBy(asc(statuses.position)),
          ),
          read(
            db
              .select({ id: components.id, name: components.name })
              .from(components)
              .where(eq(components.projectId, projectId))
              .orderBy(asc(components.name)),
          ),
          read(
            db
              .select({ id: labels.id, name: labels.name, color: labels.color })
              .from(labels)
              .where(eq(labels.projectId, projectId))
              .orderBy(asc(labels.name)),
          ),
          read(
            db
              .select({ id: users.id, name: users.name, email: users.email })
              .from(users)
              .orderBy(asc(users.name)),
          ),
          read(
            db
              .select(summaryColumns)
              .from(issues)
              .innerJoin(projects, eq(projects.id, issues.projectId))
              .where(
                and(
                  eq(issues.projectId, projectId),
                  eq(issues.type, "epic"),
                  isNull(issues.deletedAt),
                ),
              )
              .orderBy(desc(issues.number)),
          ),
          // Active first, then planned by start date (BLG-3 sprint picker).
          read(
            db
              .select({ id: sprints.id, name: sprints.name, state: sprints.state })
              .from(sprints)
              .where(and(eq(sprints.projectId, projectId), ne(sprints.state, "closed")))
              .orderBy(
                sql`${sprints.state} = 'active' DESC`,
                sql`${sprints.startDate} ASC NULLS LAST`,
                asc(sprints.createdAt),
              ),
          ),
          // REL-1: unreleased first by target date, then released ones, newest first.
          read(
            db
              .select({ id: releases.id, name: releases.name, state: releases.state })
              .from(releases)
              .where(eq(releases.projectId, projectId))
              .orderBy(
                sql`${releases.state} = 'released'`,
                sql`CASE WHEN ${releases.state} = 'unreleased' THEN ${releases.releaseDate} END ASC NULLS LAST`,
                desc(releases.releasedAt),
                asc(releases.name),
              ),
          ),
        ]);
      return {
        statuses: statusRows,
        components: componentRows,
        labels: labelRows,
        users: userRows,
        epics: epicRows.map(toSummary),
        sprints: sprintRows,
        releases: releaseRows,
      };
    },

    /**
     * Possible parents for a subtask (ISS-3): non-epic, non-subtask issues. Empty unless
     * `issueId` is a live subtask, so the issue page can ask before it knows the type.
     */
    async listSubtaskParents(projectId: IdRef, issueId: IdRef): Promise<IssueSummary[]> {
      const self = pgAlias(issues, "self");
      const rows = await read(
        db
          .select(summaryColumns)
          .from(issues)
          .innerJoin(projects, eq(projects.id, issues.projectId))
          .where(
            and(
              eq(issues.projectId, projectId),
              notInArray(issues.type, ["epic", "subtask"]),
              ne(issues.id, issueId),
              isNull(issues.deletedAt),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(self)
                  .where(
                    and(eq(self.id, issueId), eq(self.type, "subtask"), isNull(self.deletedAt)),
                  ),
              ),
            ),
          )
          .orderBy(desc(issues.number)),
      );
      return rows.map(toSummary);
    },

    async listChildren(issueId: IdRef): Promise<ChildIssue[]> {
      const rows = await read(
        db
          .select(childColumns)
          .from(issues)
          .innerJoin(projects, eq(projects.id, issues.projectId))
          .innerJoin(statuses, eq(statuses.id, issues.statusId))
          .where(and(eq(issues.parentId, issueId), isNull(issues.deletedAt)))
          .orderBy(asc(issues.number)),
      );
      return rows.map(toChild);
    },

    /**
     * Links in both directions, worded from this issue's viewpoint (ISS-6). One statement:
     * each link joined to the issue on its other end.
     */
    async listLinks(issueId: IdRef): Promise<LinkView[]> {
      const outgoing = sql<boolean>`${issueLinks.sourceIssueId} = ${issueId}`;
      const rows = await read(
        db
          .select({
            link: {
              id: issueLinks.id,
              sourceIssueId: issueLinks.sourceIssueId,
              targetIssueId: issueLinks.targetIssueId,
              type: issueLinks.type,
            },
            outgoing,
            ...childColumns,
          })
          .from(issueLinks)
          // Links to a deleted issue are hidden, not removed (ISS-13 restore brings them back).
          .innerJoin(
            issues,
            and(
              eq(
                issues.id,
                sql`CASE WHEN ${outgoing} THEN ${issueLinks.targetIssueId}
                  ELSE ${issueLinks.sourceIssueId} END`,
              ),
              isNull(issues.deletedAt),
            ),
          )
          .innerJoin(projects, eq(projects.id, issues.projectId))
          .innerJoin(statuses, eq(statuses.id, issues.statusId))
          .where(or(eq(issueLinks.sourceIssueId, issueId), eq(issueLinks.targetIssueId, issueId))),
      );
      return rows.map((row) => {
        // The viewpoint is whichever end is not the other issue.
        const viewpoint = row.outgoing ? row.link.sourceIssueId : row.link.targetIssueId;
        return {
          linkId: row.link.id,
          relation: viewLink(row.link, viewpoint).relation,
          issue: toChild(row),
        };
      });
    },

    /** Issues whose description or comments mention this one (`STK-123`, ISS-7). */
    async listMentionedIn(issueId: IdRef): Promise<MentionView[]> {
      const [fromIssues, fromComments] = await Promise.all([
        read(
          db
            .select(summaryColumns)
            .from(entityLinks)
            .innerJoin(issues, eq(issues.id, entityLinks.fromId))
            .innerJoin(projects, eq(projects.id, issues.projectId))
            .where(
              and(
                eq(entityLinks.fromType, "issue"),
                eq(entityLinks.toType, "issue"),
                eq(entityLinks.toId, issueId),
                eq(entityLinks.origin, "mention"),
                isNull(issues.deletedAt),
              ),
            ),
        ),
        read(
          db
            .selectDistinct(summaryColumns)
            .from(entityLinks)
            .innerJoin(comments, eq(comments.id, entityLinks.fromId))
            .innerJoin(issues, eq(issues.id, comments.entityId))
            .innerJoin(projects, eq(projects.id, issues.projectId))
            .where(
              and(
                eq(entityLinks.fromType, "comment"),
                eq(entityLinks.toType, "issue"),
                eq(entityLinks.toId, issueId),
                eq(comments.entityType, "issue"),
                ne(comments.entityId, issueId),
                isNull(comments.deletedAt),
                isNull(issues.deletedAt),
              ),
            ),
        ),
      ]);
      return [
        ...fromIssues.map((row) => ({ sourceKind: "issue" as const, issue: toSummary(row) })),
        ...fromComments.map((row) => ({ sourceKind: "comment" as const, issue: toSummary(row) })),
      ];
    },

    /**
     * ISS-8 history, newest first, plus keys for issue ids it mentions (parent, links). The
     * keys come from a second statement that reads the same activity rows itself, so both
     * run together.
     */
    async listActivity(
      issueId: IdRef,
    ): Promise<{ entries: ActivityView[]; issueKeys: Record<string, string> }> {
      const ACTIVITY_LIMIT = 200;
      const recent = db
        .select({
          id: activity.id,
          field: activity.field,
          fromValue: activity.fromValue,
          toValue: activity.toValue,
        })
        .from(activity)
        .where(and(eq(activity.entityType, "issue"), eq(activity.entityId, issueId)))
        .orderBy(desc(activity.createdAt), desc(activity.id))
        .limit(ACTIVITY_LIMIT)
        .as("recent");
      const [entries, keyRows] = await Promise.all([
        read(
          db
            .select({
              id: activity.id,
              actorName: users.name,
              action: activity.action,
              field: activity.field,
              fromValue: activity.fromValue,
              toValue: activity.toValue,
              meta: activity.meta,
              createdAt: activity.createdAt,
            })
            .from(activity)
            .leftJoin(users, eq(users.id, activity.actorId))
            .where(and(eq(activity.entityType, "issue"), eq(activity.entityId, issueId)))
            .orderBy(desc(activity.createdAt), desc(activity.id))
            .limit(ACTIVITY_LIMIT),
        ),
        read(
          db
            .select({ id: issues.id, number: issues.number, projectKey: projects.key })
            .from(issues)
            .innerJoin(projects, eq(projects.id, issues.projectId))
            .where(
              inArray(
                issues.id,
                // parent/links activity stores issue ids (uuids) as text; cast those, not the
                // primary key, so the lookup stays an index lookup.
                db
                  .select({
                    value: sql`unnest(ARRAY[${recent.fromValue}, ${recent.toValue}])::uuid`,
                  })
                  .from(recent)
                  .where(inArray(recent.field, ["parent", "links"])),
              ),
            ),
        ),
      ]);
      const issueKeys: Record<string, string> = {};
      for (const row of keyRows) issueKeys[row.id] = formatIssueKey(row.projectKey, row.number);
      return { entries, issueKeys };
    },

    /** ISS-10 built-in issue templates by issue type. */
    async issueTemplates(): Promise<Partial<Record<IssueType, RichTextDoc>>> {
      const rows = await read(
        db
          .select({ subtype: templates.subtype, content: templates.content })
          .from(templates)
          .where(and(eq(templates.kind, "issue"), eq(templates.builtIn, true))),
      );
      const result: Partial<Record<IssueType, RichTextDoc>> = {};
      for (const row of rows) {
        const type = ISSUE_TYPE_SET.get(row.subtype);
        if (type) result[type] = row.content;
      }
      return result;
    },
  };
}

const ISSUE_TYPE_SET = new Map<string, IssueType>(ISSUE_TYPES.map((type) => [type, type]));

export type IssueQueries = ReturnType<typeof createIssueQueries>;
