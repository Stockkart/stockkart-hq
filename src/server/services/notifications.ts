import { and, eq, isNull, lte, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { type EntityType } from "@/lib/issues/constants";
import { type DigestFrequency, type NotificationType } from "@/lib/notifications/constants";
import { notifications, users } from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

import { notFound } from "./errors";
import { rowsOf, userMentionSyncCtes, uuidOrNull } from "./sql";

/**
 * NTF-1 in-app notifications. Two ways to write them:
 *
 * - Inside the statement of the change itself (preferred): `notificationsInsert` is a CTE
 *   body, used by the issue, comment, doc and GitHub writes, so the change and its bell
 *   entries commit together and a failed notification can never half-apply a change.
 * - `notify(...)` after the caller's own write succeeded, for events that cannot join that
 *   statement. Wrap it in `notifySafely` there: a notification failure must never fail the
 *   user's action (it is logged and dropped).
 *
 * Either way every row gets `dedupe_key = <event>:<userId>` and the insert is
 * `ON CONFLICT (dedupe_key) DO NOTHING`, so a retried call adds nothing, and the actor is
 * never notified about their own change.
 */

export interface NotifyInput {
  type: NotificationType;
  /** Users to notify. Duplicates and the actor are dropped (`notificationRecipients`). */
  recipients: readonly string[];
  /** Who caused it; null for system/GitHub events. */
  actorId: string | null;
  /** What the bell entry opens, e.g. `{ type: "issue", id }` or `{ type: "doc", id }`. */
  entity: { type: EntityType; id: string };
  /** Display details, e.g. `{ issueKey: "STK-12", from: "<statusId>", to: "<statusId>" }`. */
  meta?: Record<string, unknown>;
  /**
   * Identifies the event (e.g. the activity row id). Each recipient's row gets
   * `<dedupeKey>:<userId>`, so a retried call inserts nothing new. Omit only for events
   * that cannot be retried.
   */
  dedupeKey?: string;
}

export interface NotifyResult {
  /** Rows written (0 when everything was a duplicate or nobody was left to notify). */
  created: number;
}

export type Notify = (input: NotifyInput) => Promise<NotifyResult>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Distinct recipients without the actor (nobody is notified about their own change). */
export function notificationRecipients(
  input: Pick<NotifyInput, "recipients" | "actorId">,
): string[] {
  const seen = new Set<string>();
  for (const userId of input.recipients) {
    const id = userId.toLowerCase();
    if (id !== input.actorId?.toLowerCase()) seen.add(id);
  }
  return [...seen];
}

/** The per-recipient `notifications.dedupe_key`, or null without an event key. */
export function notificationDedupeKey(
  dedupeKey: string | undefined,
  userId: string,
): string | null {
  return dedupeKey ? `${dedupeKey}:${userId.toLowerCase()}` : null;
}

/**
 * The body of a data-modifying CTE that writes one notification per row of `source`, a
 * SELECT with the columns
 *
 *   user_id uuid, type text, entity_type text, entity_id uuid, event_key text, meta jsonb
 *
 * Rows for the actor are dropped, the dedupe key is `<event_key>:<user_id>` (same rule as
 * `notificationDedupeKey`; NULL without an event key) and a key already written inserts
 * nothing. RETURNS the new rows' `id` and `user_id`.
 */
export function notificationsInsert(input: { actorId: string | null; source: SQL }): SQL {
  const actor = uuidOrNull(input.actorId);
  return sql`
    INSERT INTO notifications (user_id, type, entity_type, entity_id, actor_id, meta, dedupe_key)
    SELECT DISTINCT ON (n.user_id, n.event_key) n.user_id, n.type::notification_type,
      n.entity_type::entity_type, n.entity_id, ${actor}, n.meta,
      CASE WHEN n.event_key IS NOT NULL THEN n.event_key || ':' || lower(n.user_id::text) END
    FROM (${input.source}) AS n
    WHERE n.user_id IS NOT NULL AND n.user_id IS DISTINCT FROM ${actor}
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id, user_id`;
}

/** What an @mention notification opens (SQL, so it can come from the statement's rows). */
export interface MentionNotification {
  /** `mentioned` (issue description, issue comment) or `mentioned_in_doc`. */
  type: SQL;
  entityType: SQL;
  entityId: SQL;
  /** jsonb, e.g. `{ commentId }`. */
  meta: SQL;
}

/**
 * `userMentionSyncCtes` plus `user_mention_notified`: notifies exactly the users the sync
 * newly linked (`user_mention_added`), so a re-save never notifies again (NTF-1). The event
 * key is the mentioning entity, so even a mention removed and added back later stays one
 * bell entry. Same placement rules as the sync (inline only into the creating statement).
 */
export function userMentionNotifyCtes(
  sync: Parameters<typeof userMentionSyncCtes>[0],
  notification: MentionNotification,
): SQL {
  const eventKey = `mention:${sync.fromType}:${sync.fromId.toLowerCase()}`;
  return sql`${userMentionSyncCtes(sync)},
    user_mention_notified AS (
      ${notificationsInsert({
        actorId: sync.actorId,
        source: sql`
          SELECT a.user_id, (${notification.type})::text AS type,
            (${notification.entityType})::text AS entity_type, (${notification.entityId})::uuid AS entity_id,
            ${eventKey}::text AS event_key, (${notification.meta})::jsonb AS meta
          FROM user_mention_added a`,
      })}
    )`;
}

/**
 * The body of a CTE that tells the watchers of each issue in `activityRows` (a CTE whose
 * rows are status `activity` rows: `id, entity_id, from_value, to_value`) about the move
 * (NTF-1 "status change on watched issue"). The activity row id is the event, so a retry
 * never notifies twice. `meta` is merged into `{ from, to }` (e.g. `{ source: "github" }`).
 */
export function watcherStatusNotifications(
  actorId: string | null,
  activityRows: SQL,
  meta: SQL,
): SQL {
  return notificationsInsert({
    actorId,
    source: sql`
      SELECT w.user_id, 'status_on_watched'::text AS type, 'issue'::text AS entity_type,
        a.entity_id, 'status:' || a.id::text AS event_key,
        jsonb_build_object('from', a.from_value, 'to', a.to_value) || ${meta} AS meta
      FROM ${activityRows} a JOIN watchers w ON w.issue_id = a.entity_id`,
  });
}

/** `userMentionNotifyCtes` as a statement of its own (after an edit, like the sync). */
export function userMentionNotifyStatement(
  sync: Parameters<typeof userMentionSyncCtes>[0],
  notification: MentionNotification,
): SQL {
  return sql`WITH ${userMentionNotifyCtes(sync, notification)} SELECT user_id FROM user_mention_added`;
}

/**
 * Runs `notify` and swallows (but logs) any failure: for callers that notify AFTER their own
 * write, whose action must succeed even when the bell entry cannot be written.
 */
export async function notifySafely(notify: Notify, input: NotifyInput): Promise<NotifyResult> {
  try {
    return await notify(input);
  } catch (error) {
    // Type and entity only: meta may hold user text.
    console.error(
      `[notify] ${input.type} for ${input.entity.type} ${input.entity.id} failed:`,
      error instanceof Error ? error.message : error,
    );
    return { created: 0 };
  }
}

export function createNotificationService(db: AppDatabase) {
  /** NTF-1: one row per recipient (existing users only), deduped per recipient. */
  const notify: Notify = async (input) => {
    const recipients = notificationRecipients(input).filter((id) => UUID_PATTERN.test(id));
    if (recipients.length === 0) return { created: 0 };
    const result = await db.execute(sql`
      WITH created AS (
        ${notificationsInsert({
          actorId: input.actorId,
          source: sql`
            SELECT u.id AS user_id, ${input.type}::text AS type,
              ${input.entity.type}::text AS entity_type, ${input.entity.id}::uuid AS entity_id,
              ${input.dedupeKey ?? null}::text AS event_key,
              ${JSON.stringify(input.meta ?? {})}::jsonb AS meta
            FROM users u
            WHERE u.id IN (SELECT value::uuid
              FROM jsonb_array_elements_text(${JSON.stringify(recipients)}::jsonb))`,
        })}
      )
      SELECT count(*)::int AS created FROM created
    `);
    const [row] = rowsOf(result, z.object({ created: z.number() }));
    return { created: row?.created ?? 0 };
  };

  return {
    notify,

    /**
     * Marks one of the USER's notifications read. The recipient is part of the WHERE clause,
     * so nobody can mark (or learn about) someone else's; both look like "not found".
     */
    async markRead(userId: string, notificationId: string): Promise<void> {
      const rows = await db
        .update(notifications)
        .set({ readAt: sql`COALESCE(${notifications.readAt}, now())` })
        .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
        .returning({ id: notifications.id });
      if (rows.length === 0) throw notFound("Notification");
    },

    /**
     * Marks the user's unread notifications created up to `asOf` (when their list was
     * loaded) read, so entries that arrived since stay unread; returns how many.
     */
    async markAllRead(userId: string, asOf: Date): Promise<{ marked: number }> {
      const rows = await db
        .update(notifications)
        .set({ readAt: sql`now()` })
        .where(
          and(
            eq(notifications.userId, userId),
            isNull(notifications.readAt),
            lte(notifications.createdAt, asOf),
          ),
        )
        .returning({ id: notifications.id });
      return { marked: rows.length };
    },

    /**
     * NTF-2 opt-in. Always the session user. Turning it ON starts the first digest period
     * now (`last_digest_at`), so the first email holds what arrives from here on, never a
     * backlog from before the opt-in.
     */
    async setNotifyEmail(userId: string, enabled: boolean): Promise<{ notifyEmail: boolean }> {
      const [row] = await db
        .update(users)
        .set({
          notifyEmail: enabled,
          lastDigestAt: sql`CASE WHEN ${enabled}::boolean AND NOT ${users.notifyEmail}
            THEN now() ELSE ${users.lastDigestAt} END`,
          updatedAt: sql`now()`,
        })
        .where(eq(users.id, userId))
        .returning({ notifyEmail: users.notifyEmail });
      if (!row) throw notFound("User");
      return row;
    },

    /** NTF-2 cadence (daily / weekly). Always the session user. */
    async setDigestFrequency(
      userId: string,
      frequency: DigestFrequency,
    ): Promise<{ digestFrequency: DigestFrequency }> {
      const [row] = await db
        .update(users)
        .set({ digestFrequency: frequency, updatedAt: sql`now()` })
        .where(eq(users.id, userId))
        .returning({ digestFrequency: users.digestFrequency });
      if (!row) throw notFound("User");
      return row;
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
