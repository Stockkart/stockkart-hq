/**
 * Notification vocabulary (SPEC §4.16 NTF-1). Isomorphic: shared by the schema enum, the
 * `notify()` service and the bell UI.
 */

/**
 * NTF-1 events. `mentioned` is an @mention in an issue description or comment;
 * `mentioned_in_doc` the same in a doc, so the bell can word them differently.
 * P2 (migration 0005, appended with `ALTER TYPE … ADD VALUE`, so no later SQL migration may
 * use them until 0005 is applied everywhere): `comment_on_doc` (DOC-13: a comment or reply
 * on a doc you own or a thread you are in) and `incident_commander` (INC-1: you were made an
 * incident's commander).
 * Costs (migration 0007, same `ADD VALUE` rule): `cost_reminder` (COST-7: last month's
 * costs are not all entered yet; a system event, no actor).
 */
export const NOTIFICATION_TYPES = [
  "assigned",
  "mentioned",
  "comment_on_watched",
  "status_on_watched",
  "mentioned_in_doc",
  "comment_on_doc",
  "incident_commander",
  "cost_reminder",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** NTF-2 (P2) email digest cadence, per user (`users.digest_frequency`). */
export const DIGEST_FREQUENCIES = ["daily", "weekly"] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

/** `email_deliveries.kind`. One row per user, kind and period: the send's idempotency key. */
export const EMAIL_DELIVERY_KINDS = ["digest"] as const;
export type EmailDeliveryKind = (typeof EMAIL_DELIVERY_KINDS)[number];

/**
 * `email_deliveries.status`. A send first claims its period with a `pending` row
 * (`ON CONFLICT DO NOTHING`), then sets `sent` / `failed`. `skipped`: nothing to send for
 * the period (no email made). A `pending` row older than a few minutes is a crashed send and
 * may be reclaimed (`UPDATE … WHERE status = 'pending' AND updated_at < now() - interval`).
 */
export const EMAIL_DELIVERY_STATUSES = ["pending", "sent", "failed", "skipped"] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

/** Longest `email_deliveries.error_code` (a provider code, never a message or an address). */
export const EMAIL_ERROR_CODE_MAX = 100;
