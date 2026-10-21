"use server";

import { type ActionResult } from "@/lib/action-result";
import { z } from "zod";

import {
  BELL_LATEST,
  markAllReadInput,
  notificationIdInput,
  notifyEmailInput,
} from "@/lib/notifications/schemas";
import { type BellData } from "@/lib/notifications/views";
import { requireSession } from "@/server/auth/require-session";
import { notificationQueries, notificationService } from "@/server/services";

import { runAction } from "./action-runner";
import { NOTIFICATIONS, PROFILE, refreshPages } from "./refresh";

/**
 * NTF-1 bell and NTF-2 setting. The user is ALWAYS the session user: no action takes a user
 * id, and every query and update is scoped to it, so nobody can read or mark someone else's
 * notifications.
 */

/** The bell popover's latest entries and the current unread count, in one round trip. */
export async function loadBellAction(): Promise<ActionResult<BellData>> {
  const session = await requireSession();
  const userId = session.user.id;
  return runAction(
    z.undefined(),
    undefined,
    async () => {
      // Taken before the read, so "mark all read" never covers an entry not on screen.
      const asOf = new Date();
      const [items, unread] = await Promise.all([
        notificationQueries.latest(userId, BELL_LATEST),
        notificationQueries.unreadCount(userId),
      ]);
      return { items, unread, asOf };
    },
    () => undefined,
  );
}

export async function markNotificationReadAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  return runAction(
    notificationIdInput,
    input,
    async (data) => {
      await notificationService.markRead(session.user.id, data.notificationId);
      return undefined;
    },
    () => refreshPages(NOTIFICATIONS),
  );
}

export async function markAllNotificationsReadAction(
  input: unknown,
): Promise<ActionResult<{ marked: number }>> {
  const session = await requireSession();
  return runAction(
    markAllReadInput,
    input,
    (data) => notificationService.markAllRead(session.user.id, data.asOf),
    () => refreshPages(NOTIFICATIONS),
  );
}

/** NTF-2 email digest opt-in: stored only, no email is sent yet ("coming soon"). */
export async function setNotifyEmailAction(
  input: unknown,
): Promise<ActionResult<{ notifyEmail: boolean }>> {
  const session = await requireSession();
  return runAction(
    notifyEmailInput,
    input,
    (data) => notificationService.setNotifyEmail(session.user.id, data.enabled),
    () => refreshPages(PROFILE),
  );
}
