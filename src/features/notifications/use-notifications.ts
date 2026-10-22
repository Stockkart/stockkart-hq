"use client";

import { useState } from "react";

import { callAction } from "@/features/issue/client-utils";
import { type NotificationView } from "@/lib/notifications/views";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/server/actions/notifications";

/**
 * Optimistic read state shared by the bell and /notifications (NTF-1): marking read shows at
 * once and rolls back if the server refuses. `items` and `unread` follow new server values
 * (`serverItems`, `serverUnread`) whenever those change.
 */
export function useNotifications(
  serverItems: NotificationView[] | null,
  serverUnread: number,
  /** When `serverItems` were read: "mark all read" stops there. */
  asOf: Date | null,
) {
  const [items, setItems] = useState(serverItems);
  const [unread, setUnread] = useState(serverUnread);
  const [seen, setSeen] = useState({ items: serverItems, unread: serverUnread });
  if (seen.items !== serverItems || seen.unread !== serverUnread) {
    // Adjusting state during render (not in an effect) when the server sends new values.
    setSeen({ items: serverItems, unread: serverUnread });
    setItems(serverItems);
    setUnread(serverUnread);
  }

  async function markRead(item: NotificationView) {
    if (item.read) return;
    const markOne = (read: boolean) =>
      setItems((current) =>
        current
          ? current.map((entry) => (entry.id === item.id ? { ...entry, read } : entry))
          : current,
      );
    markOne(true);
    setUnread((count) => Math.max(0, count - 1));
    const ok = await callAction(() => markNotificationReadAction({ notificationId: item.id }));
    if (ok === null) {
      markOne(false);
      setUnread((count) => count + 1);
    }
  }

  async function markAllRead() {
    if (!asOf) return;
    const before = { items, unread };
    setItems((current) => (current ? current.map((entry) => ({ ...entry, read: true })) : current));
    setUnread(0);
    const ok = await callAction(() => markAllNotificationsReadAction({ asOf }));
    if (ok === null) {
      setItems(before.items);
      setUnread(before.unread);
    }
  }

  return { items, setItems, unread, setUnread, markRead, markAllRead };
}
