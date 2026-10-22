/**
 * Notification vocabulary (SPEC §4.16 NTF-1). Isomorphic: shared by the schema enum, the
 * `notify()` service and the bell UI.
 */

/**
 * NTF-1 events. `mentioned` is an @mention in an issue description or comment;
 * `mentioned_in_doc` the same in a doc, so the bell can word them differently.
 */
export const NOTIFICATION_TYPES = [
  "assigned",
  "mentioned",
  "comment_on_watched",
  "status_on_watched",
  "mentioned_in_doc",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
