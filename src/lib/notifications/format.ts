import { isMonth, monthLabel } from "@/lib/costs/month";

import { type NotificationType } from "./constants";
import { UNREAD_BADGE_MAX, type NotificationView } from "./views";

/**
 * Bell wording (NTF-1). Isomorphic and pure: the popover, the notifications page and the
 * tests share it.
 */

/**
 * Who did it: the HQ user, "GitHub" for GitHub-driven changes, "Stockkart HQ" for the
 * COST-7 reminder (a system event), else "Someone".
 */
export function notificationActor(
  view: Pick<NotificationView, "actorName" | "fromGithub"> & { type?: NotificationType },
) {
  if (view.actorName) return view.actorName;
  if (view.type === "cost_reminder") return "Stockkart HQ";
  return view.fromGithub ? "GitHub" : "Someone";
}

/** COST-7: "October 2026 costs are not added yet (5 items missing)". */
export function costReminderText(month: string, missingCount: number): string {
  const label = isMonth(month) ? monthLabel(month) : "Last month's";
  const items = missingCount === 1 ? "1 item" : `${missingCount} items`;
  return `${label} costs are not added yet (${items} missing)`;
}

/** One line without the actor, e.g. "assigned you STK-12" or "moved STK-3 to Done". */
export function notificationText(view: NotificationView): string {
  const target = view.target;
  const what = !target
    ? null
    : target.kind === "doc" || target.kind === "costs"
      ? `“${target.title}”`
      : target.key;
  switch (view.type) {
    case "assigned":
      return what ? `assigned you ${what}` : "assigned you an issue that was deleted";
    case "mentioned":
      if (!what) return "mentioned you in an issue that was deleted";
      return view.commentId ? `mentioned you in a comment on ${what}` : `mentioned you in ${what}`;
    case "mentioned_in_doc":
      if (!what) return "mentioned you in a doc that was deleted";
      return view.commentId ? `mentioned you in a comment on ${what}` : `mentioned you in ${what}`;
    case "comment_on_watched":
      return what ? `commented on ${what}` : "commented on an issue that was deleted";
    case "comment_on_doc":
      return what ? `commented on ${what}` : "commented on a doc that was deleted";
    case "incident_commander":
      return what
        ? `made you the commander of ${what}`
        : "made you the commander of an incident that was deleted";
    case "cost_reminder": {
      const details = view.costReminder;
      return details
        ? `reminds you: ${costReminderText(details.month, details.missingCount)}`
        : "reminds you to add last month's costs";
    }
    case "status_on_watched": {
      const subject = what ?? "an issue that was deleted";
      if (view.statusFrom && view.statusTo) {
        return `moved ${subject} from ${view.statusFrom} to ${view.statusTo}`;
      }
      return view.statusTo
        ? `moved ${subject} to ${view.statusTo}`
        : `changed the status of ${subject}`;
    }
  }
}

/** The link a notification opens; comments jump to the comment (issue tab or doc panel). */
export function notificationHref(view: Pick<NotificationView, "target" | "commentId">) {
  if (!view.target) return null;
  return view.commentId ? `${view.target.href}#comment-${view.commentId}` : view.target.href;
}

/** The unread badge text, or null for none. */
export function unreadBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > UNREAD_BADGE_MAX ? `${UNREAD_BADGE_MAX}+` : String(count);
}
