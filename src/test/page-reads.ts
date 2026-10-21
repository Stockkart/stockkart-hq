import { DEFAULT_PROJECT_KEY } from "@/features/shell/nav-items";
import { type Read } from "@/server/db/read-batch";
import { type AppDatabase } from "@/server/db/types";
import { createIssueQueries } from "@/server/services/issue-queries";
import { createNotificationQueries } from "@/server/services/notification-queries";
import { createSavedViewService } from "@/server/services/saved-views";
import { createSprintQueries } from "@/server/services/sprint-queries";
import { projectIdByKey } from "@/server/services/sql";

/**
 * Exactly the reads `src/app/(app)/layout.tsx` starts for every signed-in page, for the
 * README "Performance" round-trip tests (*-pages.db.test.ts): quick-create templates
 * (ISS-10), open sprints (BLG-3), the sidebar's saved views (VW-3) and the bell's unread
 * count (NTF-1). Keep this in step with the layout, so every page test counts them.
 */
export function appLayoutReads(db: AppDatabase, read: Read, userId: string) {
  return [
    createIssueQueries(db, { read }).issueTemplates(),
    createSprintQueries(db, { read }).openSprintOptionsByProject(),
    createSavedViewService(db, { read }).listViews(userId, projectIdByKey(DEFAULT_PROJECT_KEY)),
    createNotificationQueries(db, { read }).unreadCount(userId),
  ] as const;
}
