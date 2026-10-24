import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { DEFAULT_PROJECT_KEY } from "@/features/shell/nav-items";
import { Sidebar } from "@/features/shell/sidebar";
import { TopBar } from "@/features/shell/top-bar";
import { requirePageSession } from "@/server/auth/require-session";
import {
  issueQueries,
  notificationQueries,
  savedViewService,
  sprintQueries,
} from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";
import { getThemePreference } from "@/server/theme/preference";

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Second gate after the proxy (S-2): the app shell never renders without a session.
  const session = await requirePageSession();
  // Quick-create templates (ISS-10) and open sprints (BLG-3) come with the page, so the
  // dialog opens without a request. Read after the session check, in the same batch as the
  // page's own reads. The sidebar's saved views (VW-3) come in the same batch. The bell's
  // unread count (NTF-1) rides along in the same batch too: no round trip of its own, and
  // no client polling that would keep Neon's compute awake.
  // The theme cookie is read locally (no DB round trip).
  const [issueTemplates, sprintOptions, savedViews, unreadNotifications, themePreference] =
    await Promise.all([
      issueQueries.issueTemplates(),
      sprintQueries.openSprintOptionsByProject(),
      savedViewService.listViews(session.user.id, projectIdByKey(DEFAULT_PROJECT_KEY)),
      notificationQueries.unreadCount(session.user.id),
      getThemePreference(),
    ]);

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <Sidebar savedViews={savedViews} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          userName={session.user.name || session.user.email}
          issueTemplates={issueTemplates}
          sprintOptions={sprintOptions}
          unreadNotifications={unreadNotifications}
          themePreference={themePreference}
        />
        <main id="main" className="flex-1 p-6">
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  );
}
