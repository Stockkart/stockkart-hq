import { type EntityType } from "@/lib/issues/constants";
import { type NotificationType } from "@/lib/notifications/constants";
import { type AppDatabase } from "@/server/db/types";

/**
 * NTF-1 in-app notifications. This is the shared SIGNATURE every slice calls; the P1
 * notifications slice replaces the body of `notify` with the real insert into
 * `notifications` (one row per recipient, `ON CONFLICT (dedupe_key) DO NOTHING`). Until
 * then it does nothing, so other slices can already call it where their events happen.
 *
 * Callers fire it AFTER their own write succeeded, and a notification failure must never
 * fail the user's action (log and continue).
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
  /** Rows written (0 while the skeleton is in place, or when everything was a duplicate). */
  created: number;
}

export type Notify = (input: NotifyInput) => Promise<NotifyResult>;

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

export function createNotificationService(db: AppDatabase) {
  // Kept so the real implementation needs no wiring change; unused by the skeleton.
  void db;
  /** NTF-1 skeleton: a no-op until the notifications slice implements it. */
  const notify: Notify = async () => ({ created: 0 });
  return { notify };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
