"use client";

import Link from "next/link";

import { RelativeTime } from "@/features/issue/client-utils";
import { Avatar } from "@/features/issue/issue-badges";
import { notificationActor, notificationHref, notificationText } from "@/lib/notifications/format";
import { type NotificationView } from "@/lib/notifications/views";
import { cn } from "@/lib/utils";

/**
 * NTF-1 entries, shared by the bell popover and /notifications: actor, what happened, the
 * issue or doc, when, and whether it is unread. Opening one marks it read (`onOpen`); an
 * entry whose target was deleted is a button that only marks it read.
 */
export function NotificationList({
  items,
  onOpen,
  compact = false,
}: {
  items: NotificationView[];
  onOpen: (item: NotificationView) => void;
  compact?: boolean;
}) {
  return (
    <ul className="divide-y">
      {items.map((item) => (
        <li key={item.id}>
          <NotificationEntry item={item} onOpen={onOpen} compact={compact} />
        </li>
      ))}
    </ul>
  );
}

function NotificationEntry({
  item,
  onOpen,
  compact,
}: {
  item: NotificationView;
  onOpen: (item: NotificationView) => void;
  compact: boolean;
}) {
  const actor = notificationActor(item);
  const href = notificationHref(item);
  const body = (
    <>
      <Avatar name={actor} className="mt-0.5 size-7" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-sm", !item.read && "font-medium")}>
          <span className="font-semibold">{actor}</span> {notificationText(item)}
        </span>
        {item.target ? (
          <span className={cn("text-xs text-muted-foreground", compact && "truncate")}>
            {item.target.title}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          <RelativeTime date={item.createdAt} />
        </span>
      </span>
      {item.read ? null : (
        <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
      )}
      <span className="sr-only">{item.read ? "Read" : "Unread"}</span>
    </>
  );
  const className = cn(
    "flex w-full gap-3 px-3 py-2.5 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
    !item.read && "bg-primary/5",
  );
  return href ? (
    <Link href={href} className={className} onClick={() => onOpen(item)}>
      {body}
    </Link>
  ) : (
    <button type="button" className={className} onClick={() => onOpen(item)}>
      {body}
    </button>
  );
}
