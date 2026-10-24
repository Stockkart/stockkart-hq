import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { type ProjectGeneral, type ProjectSettings } from "@/lib/settings/views";
import { directRead } from "@/server/db/read-batch";
import {
  components,
  issueLabels,
  issues,
  labels,
  projects,
  statuses,
  users,
} from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

import { type QueryOptions } from "./issue-queries";
import { type IdRef } from "./sql";

/**
 * Read side of the project settings page (PRJ-2, PRJ-3). Every query takes the project as
 * an `IdRef`, so the page loads in ONE round trip; the usage counts are scalar subqueries
 * of the same statement.
 */
export function createSettingsQueries(db: AppDatabase, { read = directRead }: QueryOptions = {}) {
  const countWhere = (condition: ReturnType<typeof and>) =>
    sql<number>`(SELECT count(*)::int FROM ${issues} WHERE ${condition})`;

  return {
    async getSettings(projectId: IdRef): Promise<ProjectSettings | null> {
      const [projectRows, statusRows, labelRows, componentRows, userRows] = await Promise.all([
        read(
          db
            .select({
              id: projects.id,
              key: projects.key,
              name: projects.name,
              description: projects.description,
              leadId: projects.leadId,
              defaultAssigneeId: projects.defaultAssigneeId,
              sprintLengthDays: projects.sprintLengthDays,
              autoRetro: projects.autoRetro,
              boardIssueTypes: projects.boardIssueTypes,
              boardHiddenStatusIds: projects.boardHiddenStatusIds,
              listIssueTypes: projects.listIssueTypes,
              listHiddenStatusIds: projects.listHiddenStatusIds,
            })
            .from(projects)
            .where(and(eq(projects.id, projectId), isNull(projects.archivedAt)))
            .limit(1),
        ),
        read(
          db
            .select({
              id: statuses.id,
              name: statuses.name,
              category: statuses.category,
              position: statuses.position,
              isDefaultFor: statuses.isDefaultFor,
              wipLimit: statuses.wipLimit,
              issueCount: countWhere(
                and(eq(issues.statusId, statuses.id), isNull(issues.deletedAt)),
              ),
              trashedCount: countWhere(
                and(eq(issues.statusId, statuses.id), isNotNull(issues.deletedAt)),
              ),
            })
            .from(statuses)
            .where(eq(statuses.projectId, projectId))
            .orderBy(asc(statuses.position), asc(statuses.createdAt), asc(statuses.id)),
        ),
        read(
          db
            .select({
              id: labels.id,
              name: labels.name,
              color: labels.color,
              issueCount: sql<number>`(SELECT count(*)::int FROM ${issueLabels}
                JOIN ${issues} ON ${issues.id} = ${issueLabels.issueId}
                WHERE ${issueLabels.labelId} = ${labels.id} AND ${issues.deletedAt} IS NULL)`,
            })
            .from(labels)
            .where(eq(labels.projectId, projectId))
            .orderBy(asc(labels.name)),
        ),
        read(
          db
            .select({
              id: components.id,
              name: components.name,
              githubRepo: components.githubRepo,
              issueCount: countWhere(
                and(eq(issues.componentId, components.id), isNull(issues.deletedAt)),
              ),
            })
            .from(components)
            .where(eq(components.projectId, projectId))
            .orderBy(asc(components.name)),
        ),
        read(
          db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .orderBy(asc(users.name)),
        ),
      ]);
      const row = projectRows[0];
      if (!row) return null;
      const {
        boardIssueTypes,
        boardHiddenStatusIds,
        listIssueTypes,
        listHiddenStatusIds,
        ...rest
      } = row;
      const project: ProjectGeneral = rest;
      return {
        project,
        viewDefaults: {
          board: { issueTypes: boardIssueTypes, hiddenStatusIds: boardHiddenStatusIds },
          list: { issueTypes: listIssueTypes, hiddenStatusIds: listHiddenStatusIds },
        },
        statuses: statusRows,
        labels: labelRows,
        components: componentRows,
        users: userRows,
      };
    },
  };
}

export type SettingsQueries = ReturnType<typeof createSettingsQueries>;
