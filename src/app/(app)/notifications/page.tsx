import type { Metadata } from "next";
import Link from "next/link";

import { NotificationsPageList } from "@/features/notifications/notifications-page-list";
import { NOTIFICATIONS_PAGE_SIZE, notificationsPageParam } from "@/lib/notifications/schemas";
import { requirePageSession } from "@/server/auth/require-session";
import { notificationQueries } from "@/server/services";

export const metadata: Metadata = { title: "Notifications" };

interface Props {
  searchParams: Promise<{ page?: string | string[] }>;
}

/** NTF-1: every notification of the signed-in user, newest first, a page at a time. */
export default async function NotificationsPage({ searchParams }: Props) {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  const page = notificationsPageParam.parse((await searchParams).page);
  // Scoped to the session user; both reads join the layout's batch (one round trip).
  const [list, unread] = await Promise.all([
    notificationQueries.page(session.user.id, page, NOTIFICATIONS_PAGE_SIZE),
    notificationQueries.unreadCount(session.user.id),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <NotificationsPageList items={list.items} unread={unread} asOf={list.asOf} page={page} />
      {page > 1 || list.hasMore ? (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={`/notifications?page=${page - 1}`} className="hover:underline">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">Page {page}</span>
          {list.hasMore ? (
            <Link href={`/notifications?page=${page + 1}`} className="hover:underline">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
