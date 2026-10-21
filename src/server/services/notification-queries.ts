import { and, count, desc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { alias as pgAlias } from "drizzle-orm/pg-core";

import { formatIssueKey, issuePath } from "@/lib/issues/keys";
import { type NotificationType } from "@/lib/notifications/constants";
import {
  type NotificationPage,
  type NotificationTarget,
  type NotificationView,
} from "@/lib/notifications/views";
import { directRead, type Read } from "@/server/db/read-batch";
import { docs, issues, notifications, projects, statuses, users } from "@/server/db/schema";
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
  statusFrom: string | null;
  statusTo: string | null;
}

function targetOf(row: Row): NotificationTarget | null {
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
  };
}

export function createNotificationQueries(
  db: AppDatabase,
  { read = directRead }: { read?: Read } = {},
) {
  /** The user's notifications, newest first, with their target and names resolved. */
  function listQuery(userId: string, limit: number, offset: number) {
    return db
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
      .leftJoin(fromStatus, eq(fromStatus.id, metaUuid("from")))
      .leftJoin(toStatus, eq(toStatus.id, metaUuid("to")))
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit)
      .offset(offset);
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
      const rows = await read(listQuery(userId, size + 1, (page - 1) * size));
      return { items: rows.slice(0, size).map(toView), page, hasMore: rows.length > size };
    },

    /** NTF-2: the user's email-digest opt-in (stored only for now). */
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
  };
}

export type NotificationQueries = ReturnType<typeof createNotificationQueries>;
