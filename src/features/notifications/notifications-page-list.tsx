"use client";

import { Button } from "@/components/ui/button";
import { type NotificationView } from "@/lib/notifications/views";

import { NotificationList } from "./notification-list";
import { useNotifications } from "./use-notifications";

/** /notifications (NTF-1): one page of entries with optimistic "mark read". */
export function NotificationsPageList({
  items: serverItems,
  unread: serverUnread,
  asOf,
  page,
}: {
  items: NotificationView[];
  unread: number;
  /** When the page was read ("mark all read" stops there). */
  asOf: Date;
  page: number;
}) {
  const { items, unread, markRead, markAllRead } = useNotifications(
    serverItems,
    serverUnread,
    asOf,
  );
  const list = items ?? [];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {unread === 0 ? "No unread notifications." : `${unread} unread`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={unread === 0}
          onClick={() => void markAllRead()}
        >
          Mark all read
        </Button>
      </div>
      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {page > 1
            ? "No more notifications."
            : "Assignments, @mentions, and comments and status changes on issues you watch show up here."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <NotificationList items={list} onOpen={(item) => void markRead(item)} />
        </div>
      )}
    </>
  );
}
