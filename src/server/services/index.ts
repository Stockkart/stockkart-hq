import { db, read, runAtomic } from "@/server/db/client";

import { createBulkService } from "./bulk";
import { createCommentService } from "./comments";
import { createDocQueries } from "./doc-queries";
import { createDocService } from "./docs";
import { createFileQueries } from "./files";
import { createGithubService } from "./github";
import { createGithubQueries } from "./github-queries";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import { createNotificationService } from "./notifications";
import { createPlanningService } from "./planning";
import { createPlanningQueries } from "./planning-queries";
import { createProfileService } from "./profile";
import { createProjectSettingsService } from "./project-settings";
import { createSavedViewService } from "./saved-views";
import { createSearchService } from "./search";
import { createSettingsQueries } from "./settings-queries";
import { createSprintQueries } from "./sprint-queries";
import { createSprintService } from "./sprints";
import { createTodoService } from "./todos";
import { createTrashService } from "./trash";

// Wiring only: the real Neon database for the app. Tests build the same services on a
// node-postgres handle (src/test/db.ts).
// `read` batches the reads one request starts together into one Neon round trip.
export const issueService = createIssueService(db, { runAtomic, read });
export const issueQueries = createIssueQueries(db, { read });
export const commentService = createCommentService(db, { runAtomic, read });
export const planningService = createPlanningService(db, { read });
export const planningQueries = createPlanningQueries(db, { read });
export const todoService = createTodoService(db, { read });
export const searchService = createSearchService(db);
export const docService = createDocService(db, { runAtomic, read });
export const docQueries = createDocQueries(db, { read });
export const sprintService = createSprintService(db, { runAtomic, read });
export const sprintQueries = createSprintQueries(db, { read });
export const githubService = createGithubService(db);
export const githubQueries = createGithubQueries(db, { read });
export const profileService = createProfileService(db, { read });
export const fileQueries = createFileQueries(db, { read });
export const notificationService = createNotificationService(db);
// Slice A (PRJ-3, VW-3, ISS-12, ISS-13).
export const projectSettingsService = createProjectSettingsService(db, { runAtomic, read });
export const settingsQueries = createSettingsQueries(db, { read });
export const savedViewService = createSavedViewService(db, { read });
export const bulkService = createBulkService(db, { read, notify: notificationService.notify });
export const trashService = createTrashService(db, { runAtomic, read });
