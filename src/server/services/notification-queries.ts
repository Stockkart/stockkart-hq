import { and, count, desc, eq, gt, isNull, lte, type SQL, sql } from "drizzle-orm";
import { alias as pgAlias } from "drizzle-orm/pg-core";

import { isMonth, monthLabel } from "@/lib/costs/month";
import { formatIncidentKey } from "@/lib/incidents/constants";
import { incidentPath } from "@/lib/incidents/rules";
import { formatIssueKey, issuePath } from "@/lib/issues/keys";
import { type DigestFrequency, type NotificationType } from "@/lib/notifications/constants";
import {
  type CostReminderDetails,
  type NotificationPage,
  type NotificationTarget,
  type NotificationView,
} from "@/lib/notifications/views";
import { directRead, type Read } from "@/server/db/read-batch";
import {
  costItems,
  docs,
  incidents,
  issues,
  notifications,
  projects,
  statuses,
  users,
} from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

/**
 * Reads of the bell and the notifications page (NTF-1) and the NTF-2 setting. Every query
 * is scoped to `userId`, which callers take from the session: nobody can read someone
 * else's notifications. All go through `read()`, so they join the page's one round trip.
 */

const UUID_TEXT = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

/** A uuid from `meta`, or NULL when absent or malformed (meta is jsonb, not a FK). */
const metaUuid = (key: string): SQL =>
  sql`CASE WHEN ${notifications.meta}->>${key} ~* ${UUID_TEXT}
    THEN (${notifications.meta}->>${key})::uuid END`;

const actor = pgAlias(users, "notification_actor");
const issueProject = pgAlias(projects, "notification_issue_project");
const docProject = pgAlias(projects, "notification_doc_project");
const incidentProject = pgAlias(projects, "notification_incident_project");
const costProject = pgAlias(projects, "notification_cost_project");
const fromStatus = pgAlias(statuses, "notification_from_status");
const toStatus = pgAlias(statuses, "notification_to_status");

interface Row {
  id: string;
  type: NotificationType;
  meta: Record<string, unknown> | null;
  readAt: Date | null;
  createdAt: Date;
  actorName: string | null;
  issueNumber: number | null;
  issueTitle: string | null;
  issueProjectKey: string | null;
  docId: string | null;
  docTitle: string | null;
  docProjectKey: string | null;
  incidentNumber: number | null;
  incidentTitle: string | null;
  incidentProjectKey: string | null;
  costProjectKey: string | null;
  statusFrom: string | null;
  statusTo: string | null;
}

/** COST-7 `meta` ({ month, missingCount }), when well-formed. */
function costReminderOf(row: Row): CostReminderDetails | null {
  if (row.type !== "cost_reminder") return null;
  const month = row.meta?.month;
  const missingCount = row.meta?.missingCount;
  if (!isMonth(month) || typeof missingCount !== "number" || !Number.isInteger(missingCount)) {
    return null;
  }
  return { month, missingCount };
}

function targetOf(row: Row): NotificationTarget | null {
  // COST-7 `cost_reminder`: the costs page on that month (the entity is one of the
  // project's cost items; the reminder is about the month, not the item).
  if (row.type === "cost_reminder") {
    const details = costReminderOf(row);
    if (!details || !isMonth(details.month) || !row.costProjectKey) return null;
    return {
      kind: "costs",
      title: `${monthLabel(details.month)} costs`,
      href: `/${row.costProjectKey}/costs?month=${details.month}`,
    };
  }
  if (row.issueNumber !== null && row.issueTitle !== null && row.issueProjectKey !== null) {
    return {
      kind: "issue",
      key: formatIssueKey(row.issueProjectKey, row.issueNumber),
      title: row.issueTitle,
      href: issuePath(row.issueProjectKey, row.issueNumber),
    };
  }
  if (row.docId !== null && row.docTitle !== null && row.docProjectKey !== null) {
    return { kind: "doc", title: row.docTitle, href: `/${row.docProjectKey}/docs/${row.docId}` };
  }
  // INC-1 `incident_commander`.
  if (row.incidentNumber !== null && row.incidentTitle !== null && row.incidentProjectKey) {
    return {
      kind: "incident",
      key: formatIncidentKey(row.incidentNumber),
      title: row.incidentTitle,
      href: incidentPath(row.incidentProjectKey, row.incidentNumber),
    };
  }
  return null;
}

function toView(row: Row): NotificationView {
  const commentId = row.meta?.commentId;
  return {
    id: row.id,
    type: row.type,
    actorName: row.actorName,
    fromGithub: row.meta?.source === "github",
    target: targetOf(row),
    statusFrom: row.statusFrom,
    statusTo: row.statusTo,
    commentId:
      typeof commentId === "string" && new RegExp(UUID_TEXT, "i").test(commentId)
        ? commentId
        : null,
    read: row.readAt !== null,
    createdAt: row.createdAt,
    ...(row.type === "cost_reminder" ? { costReminder: costReminderOf(row) } : {}),
  };
}

export function createNotificationQueries(
  db: AppDatabase,
  { read = directRead }: { read?: Read } = {},
) {
  /** The user's notifications, newest first, with their target and names resolved. */
  function listQuery(userId: string, limit: number, offset: number, where?: SQL) {
    return (
      db
        .select({
          id: notifications.id,
          type: notifications.type,
          meta: notifications.meta,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
          actorName: actor.name,
          issueNumber: issues.number,
          issueTitle: issues.title,
          issueProjectKey: issueProject.key,
          docId: docs.id,
          docTitle: docs.title,
          docProjectKey: docProject.key,
          incidentNumber: incidents.number,
          incidentTitle: incidents.title,
          incidentProjectKey: incidentProject.key,
          costProjectKey: costProject.key,
          statusFrom: fromStatus.name,
          statusTo: toStatus.name,
        })
        .from(notifications)
        .leftJoin(actor, eq(actor.id, notifications.actorId))
        .leftJoin(
          issues,
          and(
            eq(notifications.entityType, "issue"),
            eq(issues.id, notifications.entityId),
            isNull(issues.deletedAt),
          ),
        )
        .leftJoin(issueProject, eq(issueProject.id, issues.projectId))
        .leftJoin(
          docs,
          and(
            eq(notifications.entityType, "doc"),
            eq(docs.id, notifications.entityId),
            isNull(docs.deletedAt),
          ),
        )
        .leftJoin(docProject, eq(docProject.id, docs.projectId))
        .leftJoin(
          incidents,
          and(
            eq(notifications.entityType, "incident"),
            eq(incidents.id, notifications.entityId),
            isNull(incidents.deletedAt),
          ),
        )
        .leftJoin(incidentProject, eq(incidentProject.id, incidents.projectId))
        // COST-7: a deleted item still names its project (the month is what matters).
        .leftJoin(
          costItems,
          and(eq(notifications.entityType, "cost_item"), eq(costItems.id, notifications.entityId)),
        )
        .leftJoin(
          costProject,
          and(eq(costProject.id, costItems.projectId), isNull(costProject.archivedAt)),
        )
        .leftJoin(fromStatus, eq(fromStatus.id, metaUuid("from")))
        .leftJoin(toStatus, eq(toStatus.id, metaUuid("to")))
        .where(and(eq(notifications.userId, userId), where))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(limit)
        .offset(offset)
    );
  }

  return {
    /** The bell badge: the user's unread notifications. */
    async unreadCount(userId: string): Promise<number> {
      const [row] = await read(
        db
          .select({ unread: count() })
          .from(notifications)
          .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
      );
      return row?.unread ?? 0;
    },

    /** The bell popover: the latest `limit`, read and unread. */
    async latest(userId: string, limit: number): Promise<NotificationView[]> {
      return (await read(listQuery(userId, limit, 0))).map(toView);
    },

    /** One page of /notifications (1-based); one extra row tells whether more follow. */
    async page(userId: string, page: number, size: number): Promise<NotificationPage> {
      // Taken before the read, so "mark all read" never covers an entry not on screen.
      const asOf = new Date();
      const rows = await read(listQuery(userId, size + 1, (page - 1) * size));
      return { items: rows.slice(0, size).map(toView), page, hasMore: rows.length > size, asOf };
    },

    /** NTF-2: the user's email-digest opt-in. */
    async notifyEmail(userId: string): Promise<boolean> {
      const [row] = await read(
        db
          .select({ notifyEmail: users.notifyEmail })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1),
      );
      return row?.notifyEmail ?? false;
    },

    /** NTF-2: the user's email-digest settings (opt-in and cadence). */
    async digestSettings(
      userId: string,
    ): Promise<{ notifyEmail: boolean; digestFrequency: DigestFrequency }> {
      const [row] = await read(
        db
          .select({ notifyEmail: users.notifyEmail, digestFrequency: users.digestFrequency })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1),
      );
      return row ?? { notifyEmail: false, digestFrequency: "daily" };
    },

    /**
     * NTF-2 digest items: the user's UNREAD notifications created in the period
     * (`after` < created_at ≤ `upTo`), newest first, at most `limit`, plus how many there
     * are in all (for "and N more"). Read in one round trip.
     */
    async unreadInPeriod(
      userId: string,
      period: { after: Date; upTo: Date },
      limit: number,
    ): Promise<{ items: NotificationView[]; total: number }> {
      const inPeriod = and(
        isNull(notifications.readAt),
        gt(notifications.createdAt, period.after),
        lte(notifications.createdAt, period.upTo),
      );
      const [rows, [counted]] = await Promise.all([
        read(listQuery(userId, limit, 0, inPeriod)),
        read(
          db
            .select({ total: count() })
            .from(notifications)
            .where(and(eq(notifications.userId, userId), inPeriod)),
        ),
      ]);
      return { items: rows.map(toView), total: counted?.total ?? 0 };
    },
  };
}

export type NotificationQueries = ReturnType<typeof createNotificationQueries>;
