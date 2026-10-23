import { db, read, runAtomic } from "@/server/db/client";
import { storage } from "@/server/storage";

import { createAttachmentService } from "./attachments";
import { createBulkService } from "./bulk";
import { createCommentService } from "./comments";
import { createDiagramQueries } from "./diagram-queries";
import { createDiagramService } from "./diagrams";
import { createDocQueries } from "./doc-queries";
import { createDocService } from "./docs";
import { createFileQueries } from "./files";
import { createGithubService } from "./github";
import { createGithubQueries } from "./github-queries";
import { createImportQueries, createImportService } from "./imports";
import { createIncidentQueries } from "./incident-queries";
import { createIncidentService } from "./incidents";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import { createMentionQueries } from "./mentions";
import { createNotificationQueries } from "./notification-queries";
import { createNotificationService } from "./notifications";
import { createPlanningService } from "./planning";
import { createPlanningQueries } from "./planning-queries";
import { createProfileService } from "./profile";
import { createProjectSettingsService } from "./project-settings";
import { createReleaseQueries } from "./release-queries";
import { createReleaseService } from "./releases";
import { createRoadmapQueries } from "./roadmap-queries";
import { createSavedViewService } from "./saved-views";
import { createSearchService } from "./search";
import { createServiceRegistry, createServiceRegistryQueries } from "./service-registry";
import { createSettingsQueries } from "./settings-queries";
import { createSprintQueries } from "./sprint-queries";
import { createSprintService } from "./sprints";
import { createTodoService } from "./todos";
import { createTrashService } from "./trash";
import { createWatcherService } from "./watchers";

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
export const attachmentService = createAttachmentService(db, { storage });
export const notificationService = createNotificationService(db);
// Slice A (PRJ-3, VW-3, ISS-12, ISS-13).
export const projectSettingsService = createProjectSettingsService(db, { runAtomic, read });
export const settingsQueries = createSettingsQueries(db, { read });
export const savedViewService = createSavedViewService(db, { read });
export const bulkService = createBulkService(db, { read, notify: notificationService.notify });
export const trashService = createTrashService(db, { runAtomic, read });
// Slice B (NTF-1, mentions, watchers).
export const notificationQueries = createNotificationQueries(db, { read });
export const watcherService = createWatcherService(db, { read });
export const mentionQueries = createMentionQueries(db, { read });
// Slice B (P2: REL-1/2 releases).
export const releaseService = createReleaseService(db, { runAtomic, read });
export const releaseQueries = createReleaseQueries(db, { read });
// Slice B (P2: IMP-4 CSV import).
export const importService = createImportService(db, { runAtomic, read });
export const importQueries = createImportQueries(db, { read });
// Slice D (DGM-*).
export const diagramService = createDiagramService(db, { runAtomic, read, storage });
export const diagramQueries = createDiagramQueries(db, { read });
// P2 slice A (RDM-1/2).
export const roadmapQueries = createRoadmapQueries(db, { read });
// P2 slice C (INC-1/2, SVC-1).
export const serviceRegistry = createServiceRegistry(db, { runAtomic, read });
export const serviceRegistryQueries = createServiceRegistryQueries(db, { read });
export const incidentService = createIncidentService(db, { runAtomic, read });
export const incidentQueries = createIncidentQueries(db, { read });
