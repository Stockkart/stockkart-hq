"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { callAction } from "@/features/issue/client-utils";
import { unreadBadge } from "@/lib/notifications/format";
import { type NotificationView } from "@/lib/notifications/views";
import { loadBellAction } from "@/server/actions/notifications";

import { NotificationList } from "./notification-list";
import { useNotifications } from "./use-notifications";

/**
 * NTF-1 bell in the top bar. The unread count comes with the app layout's batched read
 * (no extra round trip, and no polling that would keep Neon's compute awake); opening the
 * bell loads the latest entries and a fresh count with one action. Radix positions the
 * popover and handles Esc, outside clicks and focus return; the popover is a labelled
 * dialog holding a plain list of links.
 */
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [open, setOpen] = useState(false);
  // The latest count from the server: the layout's (on each render of it) or the last load.
  const [serverUnread, setServerUnread] = useState(initialUnread);
  const [seenInitial, setSeenInitial] = useState(initialUnread);
  if (seenInitial !== initialUnread) {
    setSeenInitial(initialUnread);
    setServerUnread(initialUnread);
  }
  const [loaded, setLoaded] = useState<{ items: NotificationView[]; asOf: Date } | null>(null);
  const [loading, startLoading] = useTransition();
  const { items, unread, markRead, markAllRead } = useNotifications(
    loaded?.items ?? null,
    serverUnread,
    loaded?.asOf ?? null,
  );
  const badge = unreadBadge(unread);

  function load() {
    startLoading(async () => {
      const data = await callAction(() => loadBellAction());
      if (!data) return;
      setLoaded({ items: data.items, asOf: data.asOf });
      setServerUnread(data.unread);
    });
  }

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell aria-hidden="true" />
          {badge ? (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white"
            >
              {badge}
            </span>
          ) : null}
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          aria-label="Notifications"
          className="z-50 flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-96 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md outline-none"
        >
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={unread === 0 || items === null}
              onClick={() => void markAllRead()}
            >
              Mark all read
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
            {items === null ? (
              <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
                {loading ? "Loading…" : "Could not load notifications."}
              </p>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                You are all caught up.
              </p>
            ) : (
              <NotificationList
                compact
                items={items}
                onOpen={(item) => {
                  void markRead(item);
                  if (item.target) setOpen(false);
                }}
              />
            )}
          </div>
          <div className="border-t px-3 py-2 text-center">
            <Link
              href="/notifications"
              className="text-xs font-medium hover:underline"
              onClick={() => setOpen(false)}
            >
              View all notifications
            </Link>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
