import { and, asc, desc, eq, inArray, isNull, ne, notInArray, or } from "drizzle-orm";
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
import {
  activity,
  comments,
  components,
  entityLinks,
  issueLabels,
  issueLinks,
  issues,
  labels,
  projects,
  statuses,
  templates,
  users,
} from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

/** Read side for the issue pages. Every query skips soft-deleted issues. */
export function createIssueQueries(db: AppDatabase) {
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

  async function childIssues(where: ReturnType<typeof and>): Promise<ChildIssue[]> {
    const rows = await db
      .select({
        ...summaryColumns,
        priority: issues.priority,
        statusId: statuses.id,
        statusName: statuses.name,
        statusCategory: statuses.category,
      })
      .from(issues)
      .innerJoin(projects, eq(projects.id, issues.projectId))
      .innerJoin(statuses, eq(statuses.id, issues.statusId))
      .where(and(where, isNull(issues.deletedAt)))
      .orderBy(asc(issues.number));
    return rows.map((row) => ({
      ...toSummary(row),
      priority: row.priority,
      status: { id: row.statusId, name: row.statusName, category: row.statusCategory },
    }));
  }

  return {
    async getProject(key: string) {
      const [project] = await db
        .select({ id: projects.id, key: projects.key, name: projects.name })
        .from(projects)
        .where(and(eq(projects.key, key), isNull(projects.archivedAt)))
        .limit(1);
      return project ?? null;
    },

    async listProjectKeys(): Promise<string[]> {
      const rows = await db.select({ key: projects.key }).from(projects);
      return rows.map((row) => row.key);
    },

    /** Issue list (§4.10 basic form): newest first. Filters arrive with VW-1. */
    async listIssues(projectId: string): Promise<IssueListItem[]> {
      const rows = await db
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
        .orderBy(desc(issues.number));
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

    async getIssue(projectId: string, number: number): Promise<IssueDetail | null> {
      const reporter = pgAlias(users, "reporter");
      const parent = pgAlias(issues, "parent");
      const [row] = await db
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
        })
        .from(issues)
        .innerJoin(projects, eq(projects.id, issues.projectId))
        .leftJoin(reporter, eq(reporter.id, issues.reporterId))
        .leftJoin(parent, and(eq(parent.id, issues.parentId), isNull(parent.deletedAt)))
        .where(
          and(eq(issues.projectId, projectId), eq(issues.number, number), isNull(issues.deletedAt)),
        )
        .limit(1);
      if (!row) return null;
      const issueLabelRows = await db
        .select({ id: labels.id, name: labels.name, color: labels.color })
        .from(issueLabels)
        .innerJoin(labels, eq(labels.id, issueLabels.labelId))
        .where(eq(issueLabels.issueId, row.issue.id))
        .orderBy(asc(labels.name));
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
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        resolvedAt: issue.resolvedAt,
        labels: issueLabelRows,
      };
    },

    /** Side-panel options: statuses, components, labels, every HQ user, epics. */
    async getProjectMeta(projectId: string): Promise<ProjectMeta> {
      const [statusRows, componentRows, labelRows, userRows, epicRows] = await Promise.all([
        db
          .select({ id: statuses.id, name: statuses.name, category: statuses.category })
          .from(statuses)
          .where(eq(statuses.projectId, projectId))
          .orderBy(asc(statuses.position)),
        db
          .select({ id: components.id, name: components.name })
          .from(components)
          .where(eq(components.projectId, projectId))
          .orderBy(asc(components.name)),
        db
          .select({ id: labels.id, name: labels.name, color: labels.color })
          .from(labels)
          .where(eq(labels.projectId, projectId))
          .orderBy(asc(labels.name)),
        db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .orderBy(asc(users.name)),
        db
          .select(summaryColumns)
          .from(issues)
          .innerJoin(projects, eq(projects.id, issues.projectId))
          .where(
            and(eq(issues.projectId, projectId), eq(issues.type, "epic"), isNull(issues.deletedAt)),
          )
          .orderBy(desc(issues.number)),
      ]);
      return {
        statuses: statusRows,
        components: componentRows,
        labels: labelRows,
        users: userRows,
        epics: epicRows.map(toSummary),
      };
    },

    /** Possible parents for a subtask (ISS-3): non-epic, non-subtask issues. */
    async listSubtaskParents(projectId: string, excludeId: string): Promise<IssueSummary[]> {
      const rows = await db
        .select(summaryColumns)
        .from(issues)
        .innerJoin(projects, eq(projects.id, issues.projectId))
        .where(
          and(
            eq(issues.projectId, projectId),
            notInArray(issues.type, ["epic", "subtask"]),
            ne(issues.id, excludeId),
            isNull(issues.deletedAt),
          ),
        )
        .orderBy(desc(issues.number));
      return rows.map(toSummary);
    },

    async listChildren(issueId: string): Promise<ChildIssue[]> {
      return childIssues(eq(issues.parentId, issueId));
    },

    /** Links in both directions, worded from this issue's viewpoint (ISS-6). */
    async listLinks(issueId: string): Promise<LinkView[]> {
      const rows = await db
        .select({
          id: issueLinks.id,
          sourceIssueId: issueLinks.sourceIssueId,
          targetIssueId: issueLinks.targetIssueId,
          type: issueLinks.type,
        })
        .from(issueLinks)
        .where(or(eq(issueLinks.sourceIssueId, issueId), eq(issueLinks.targetIssueId, issueId)));
      if (rows.length === 0) return [];
      const views = rows.map((row) => ({ linkId: row.id, ...viewLink(row, issueId) }));
      const others = await childIssues(
        inArray(
          issues.id,
          views.map((view) => view.otherIssueId),
        ),
      );
      const byId = new Map(others.map((other) => [other.id, other]));
      return views.flatMap((view) => {
        const issue = byId.get(view.otherIssueId);
        // Links to a deleted issue are hidden, not removed (ISS-13 restore brings them back).
        return issue ? [{ linkId: view.linkId, relation: view.relation, issue }] : [];
      });
    },

    /** Issues whose description or comments mention this one (`STK-123`, ISS-7). */
    async listMentionedIn(issueId: string): Promise<MentionView[]> {
      const fromIssues = await db
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
        );
      const fromComments = await db
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
        );
      return [
        ...fromIssues.map((row) => ({ sourceKind: "issue" as const, issue: toSummary(row) })),
        ...fromComments.map((row) => ({ sourceKind: "comment" as const, issue: toSummary(row) })),
      ];
    },

    /** ISS-8 history, newest first, plus keys for issue ids it mentions (parent, links). */
    async listActivity(
      issueId: string,
    ): Promise<{ entries: ActivityView[]; issueKeys: Record<string, string> }> {
      const entries = await db
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
        .limit(200);
      const ids = new Set<string>();
      for (const entry of entries) {
        if (entry.field !== "parent" && entry.field !== "links") continue;
        if (entry.fromValue) ids.add(entry.fromValue);
        if (entry.toValue) ids.add(entry.toValue);
      }
      const issueKeys: Record<string, string> = {};
      if (ids.size > 0) {
        const rows = await db
          .select({ id: issues.id, number: issues.number, projectKey: projects.key })
          .from(issues)
          .innerJoin(projects, eq(projects.id, issues.projectId))
          .where(inArray(issues.id, [...ids]));
        for (const row of rows) issueKeys[row.id] = formatIssueKey(row.projectKey, row.number);
      }
      return { entries, issueKeys };
    },

    /** ISS-10 built-in issue templates by issue type. */
    async issueTemplates(): Promise<Partial<Record<IssueType, RichTextDoc>>> {
      const rows = await db
        .select({ subtype: templates.subtype, content: templates.content })
        .from(templates)
        .where(and(eq(templates.kind, "issue"), eq(templates.builtIn, true)));
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
