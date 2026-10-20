import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias as pgAlias } from "drizzle-orm/pg-core";

import { type StatusCategory } from "@/lib/issues/constants";
import {
  ASSIGNEE_ME,
  ASSIGNEE_NONE,
  type IssueFilters,
  type IssueSort,
} from "@/lib/issues/filters";
import { formatIssueKey, issuePath, parseIssueKey } from "@/lib/issues/keys";
import { type LabelView, type PlanningIssue } from "@/lib/issues/views";
import {
  components,
  docs,
  issueLabels,
  issues,
  labels,
  projects,
  recentViews,
  statuses,
  users,
} from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

/**
 * Which issues a planning page shows:
 * - `all`: the issue list (VW-1).
 * - `backlog`: not-done issues outside an active sprint (BLG-1).
 * - `board`: open issues plus done ones resolved in the last `BOARD_DONE_DAYS` days (BRD-3;
 *   sprints arrive with SPR-1, until then the board has no sprint scope).
 */
export type IssueScope = "all" | "backlog" | "board";
export const BOARD_DONE_DAYS = 14;

export interface ListIssuesOptions {
  scope: IssueScope;
  filters: IssueFilters;
  /** Ignored for the backlog and board, which are always in rank order. */
  sort?: IssueSort;
  /** Resolves the `me` assignee filter. */
  currentUserId: string;
}

export interface RecentItem {
  kind: "issue" | "doc";
  id: string;
  title: string;
  /** Issue key, or null for docs. */
  key: string | null;
  href: string;
  viewedAt: Date;
}

/** `%`, `_` and `\` are wildcards in LIKE; match them literally. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/** Read side for the list, backlog, board and My Work. Every query skips deleted rows. */
export function createPlanningQueries(db: AppDatabase) {
  const epic = pgAlias(issues, "epic");

  function filterConditions(filters: IssueFilters, currentUserId: string): SQL[] {
    const conditions: SQL[] = [];
    if (filters.types.length > 0) conditions.push(inArray(issues.type, filters.types));
    if (filters.statuses.length > 0) conditions.push(inArray(issues.statusId, filters.statuses));
    if (filters.priorities.length > 0) {
      conditions.push(inArray(issues.priority, filters.priorities));
    }
    if (filters.assignees.length > 0) {
      const ids = filters.assignees
        .filter((value) => value !== ASSIGNEE_NONE)
        .map((value) => (value === ASSIGNEE_ME ? currentUserId : value));
      const options: SQL[] = [];
      if (ids.length > 0) options.push(inArray(issues.assigneeId, ids));
      if (filters.assignees.includes(ASSIGNEE_NONE)) options.push(isNull(issues.assigneeId));
      const either = or(...options);
      if (either) conditions.push(either);
    }
    if (filters.components.length > 0) {
      conditions.push(inArray(issues.componentId, filters.components));
    }
    if (filters.labels.length > 0) {
      // Any of the chosen labels (OR within a dimension, AND across dimensions).
      conditions.push(
        exists(
          db
            .select({ one: sql`1` })
            .from(issueLabels)
            .where(
              and(eq(issueLabels.issueId, issues.id), inArray(issueLabels.labelId, filters.labels)),
            ),
        ),
      );
    }
    if (filters.text) {
      // Full-text match (stemmed words, as in ⌘K search), a title substring (so partial
      // words like "outb" still match), or the issue key itself.
      const options: SQL[] = [
        sql`${issues.search} @@ websearch_to_tsquery('english', ${filters.text})`,
        ilike(issues.title, likePattern(filters.text)),
      ];
      const ref = parseIssueKey(filters.text);
      const keyMatch = ref
        ? and(eq(projects.key, ref.projectKey), eq(issues.number, ref.number))
        : undefined;
      if (keyMatch) options.push(keyMatch);
      const either = or(...options);
      if (either) conditions.push(either);
    }
    return conditions;
  }

  function scopeCondition(scope: IssueScope): SQL | undefined {
    switch (scope) {
      case "all":
        return undefined;
      case "backlog":
        return and(
          ne(statuses.category, "done"),
          sql`NOT EXISTS (SELECT 1 FROM sprints s WHERE s.id = ${issues.sprintId} AND s.state = 'active')`,
        );
      case "board":
        return or(
          ne(statuses.category, "done"),
          sql`${issues.resolvedAt} >= now() - make_interval(days => ${BOARD_DONE_DAYS})`,
        );
    }
  }

  function orderBy(scope: IssueScope, sort: IssueSort | undefined): SQL[] {
    if (scope !== "all" || !sort) return [asc(issues.rank)];
    const dir = sort.dir === "asc" ? asc : desc;
    // Nulls (unassigned, no points) sort last in both directions.
    const nullsLast = (column: SQL) =>
      sort.dir === "asc" ? sql`${column} ASC NULLS LAST` : sql`${column} DESC NULLS LAST`;
    const primary: Record<IssueSort["by"], SQL> = {
      key: dir(issues.number),
      type: dir(issues.type),
      title: dir(sql`lower(${issues.title})`),
      status: dir(statuses.position),
      priority: dir(issues.priority),
      assignee: nullsLast(sql`lower(${users.name})`),
      points: nullsLast(sql`${issues.storyPoints}`),
      created: dir(issues.createdAt),
      updated: dir(issues.updatedAt),
    };
    // Ties: newest first, so the order is stable between reloads.
    return [primary[sort.by], desc(issues.number)];
  }

  async function labelsFor(issueIds: string[]): Promise<Map<string, LabelView[]>> {
    const byIssue = new Map<string, LabelView[]>();
    if (issueIds.length === 0) return byIssue;
    const rows = await db
      .select({
        issueId: issueLabels.issueId,
        id: labels.id,
        name: labels.name,
        color: labels.color,
      })
      .from(issueLabels)
      .innerJoin(labels, eq(labels.id, issueLabels.labelId))
      .where(inArray(issueLabels.issueId, issueIds))
      .orderBy(asc(labels.name));
    for (const { issueId, ...label } of rows) {
      const list = byIssue.get(issueId) ?? [];
      list.push(label);
      byIssue.set(issueId, list);
    }
    return byIssue;
  }

  return {
    async listIssues(projectId: string, options: ListIssuesOptions): Promise<PlanningIssue[]> {
      const rows = await db
        .select({
          id: issues.id,
          number: issues.number,
          title: issues.title,
          type: issues.type,
          priority: issues.priority,
          storyPoints: issues.storyPoints,
          rank: issues.rank,
          createdAt: issues.createdAt,
          updatedAt: issues.updatedAt,
          resolvedAt: issues.resolvedAt,
          projectKey: projects.key,
          statusId: statuses.id,
          statusName: statuses.name,
          statusCategory: statuses.category,
          assigneeId: users.id,
          assigneeName: users.name,
          componentId: components.id,
          componentName: components.name,
          epicId: epic.id,
          epicNumber: epic.number,
          epicTitle: epic.title,
        })
        .from(issues)
        .innerJoin(projects, eq(projects.id, issues.projectId))
        .innerJoin(statuses, eq(statuses.id, issues.statusId))
        .leftJoin(users, eq(users.id, issues.assigneeId))
        .leftJoin(components, eq(components.id, issues.componentId))
        .leftJoin(
          epic,
          and(eq(epic.id, issues.parentId), eq(epic.type, "epic"), isNull(epic.deletedAt)),
        )
        .where(
          and(
            eq(issues.projectId, projectId),
            isNull(issues.deletedAt),
            scopeCondition(options.scope),
            ...filterConditions(options.filters, options.currentUserId),
          ),
        )
        .orderBy(...orderBy(options.scope, options.sort));
      const labelMap = await labelsFor(rows.map((row) => row.id));
      return rows.map((row) => ({
        id: row.id,
        key: formatIssueKey(row.projectKey, row.number),
        number: row.number,
        title: row.title,
        type: row.type,
        priority: row.priority,
        status: { id: row.statusId, name: row.statusName, category: row.statusCategory },
        assignee:
          row.assigneeId && row.assigneeName
            ? { id: row.assigneeId, name: row.assigneeName }
            : null,
        component:
          row.componentId && row.componentName
            ? { id: row.componentId, name: row.componentName }
            : null,
        epic:
          row.epicId && row.epicNumber !== null && row.epicTitle !== null
            ? {
                id: row.epicId,
                key: formatIssueKey(row.projectKey, row.epicNumber),
                title: row.epicTitle,
                type: "epic",
              }
            : null,
        storyPoints: row.storyPoints,
        labels: labelMap.get(row.id) ?? [],
        rank: row.rank,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        resolvedAt: row.resolvedAt,
      }));
    },

    /**
     * MY-1: the user's issues in every project, by status category. Done issues only from
     * the last `BOARD_DONE_DAYS` days, so the page does not grow forever.
     */
    async listAssignedTo(userId: string) {
      const rows = await db
        .select({
          id: issues.id,
          number: issues.number,
          title: issues.title,
          type: issues.type,
          priority: issues.priority,
          projectKey: projects.key,
          statusId: statuses.id,
          statusName: statuses.name,
          statusCategory: statuses.category,
        })
        .from(issues)
        .innerJoin(projects, eq(projects.id, issues.projectId))
        .innerJoin(statuses, eq(statuses.id, issues.statusId))
        .where(
          and(
            eq(issues.assigneeId, userId),
            isNull(issues.deletedAt),
            or(
              ne(statuses.category, "done"),
              sql`${issues.resolvedAt} >= now() - make_interval(days => ${BOARD_DONE_DAYS})`,
            ),
          ),
        )
        .orderBy(asc(issues.priority), asc(issues.rank));
      const groups: Record<StatusCategory, AssignedIssue[]> = {
        in_progress: [],
        todo: [],
        done: [],
      };
      for (const row of rows) {
        groups[row.statusCategory].push({
          id: row.id,
          key: formatIssueKey(row.projectKey, row.number),
          href: issuePath(row.projectKey, row.number),
          title: row.title,
          type: row.type,
          priority: row.priority,
          status: { id: row.statusId, name: row.statusName, category: row.statusCategory },
        });
      }
      return groups;
    },

    /** MY-1 "recently viewed": live issues and docs the user opened, newest first. */
    async listRecentlyViewed(userId: string, limit = 10): Promise<RecentItem[]> {
      const [issueRows, docRows] = await Promise.all([
        db
          .select({
            id: issues.id,
            number: issues.number,
            title: issues.title,
            projectKey: projects.key,
            viewedAt: recentViews.viewedAt,
          })
          .from(recentViews)
          .innerJoin(issues, eq(issues.id, recentViews.entityId))
          .innerJoin(projects, eq(projects.id, issues.projectId))
          .where(
            and(
              eq(recentViews.userId, userId),
              eq(recentViews.entityType, "issue"),
              isNull(issues.deletedAt),
            ),
          )
          .orderBy(desc(recentViews.viewedAt))
          .limit(limit),
        // Docs are recorded by the docs pages (slice 3); listed here as soon as rows exist.
        db
          .select({
            id: docs.id,
            title: docs.title,
            projectKey: projects.key,
            viewedAt: recentViews.viewedAt,
          })
          .from(recentViews)
          .innerJoin(docs, eq(docs.id, recentViews.entityId))
          .innerJoin(projects, eq(projects.id, docs.projectId))
          .where(
            and(
              eq(recentViews.userId, userId),
              eq(recentViews.entityType, "doc"),
              isNull(docs.deletedAt),
            ),
          )
          .orderBy(desc(recentViews.viewedAt))
          .limit(limit),
      ]);
      const items: RecentItem[] = [
        ...issueRows.map((row) => ({
          kind: "issue" as const,
          id: row.id,
          title: row.title,
          key: formatIssueKey(row.projectKey, row.number),
          href: issuePath(row.projectKey, row.number),
          viewedAt: row.viewedAt,
        })),
        ...docRows.map((row) => ({
          kind: "doc" as const,
          id: row.id,
          title: row.title,
          key: null,
          href: `/${row.projectKey}/docs/${row.id}`,
          viewedAt: row.viewedAt,
        })),
      ];
      return items.sort((a, b) => b.viewedAt.getTime() - a.viewedAt.getTime()).slice(0, limit);
    },
  };
}

export interface AssignedIssue {
  id: string;
  key: string;
  href: string;
  title: string;
  type: PlanningIssue["type"];
  priority: PlanningIssue["priority"];
  status: PlanningIssue["status"];
}

export type PlanningQueries = ReturnType<typeof createPlanningQueries>;
