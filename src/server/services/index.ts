import { db, read, runAtomic } from "@/server/db/client";

import { createCommentService } from "./comments";
import { createDocQueries } from "./doc-queries";
import { createDocService } from "./docs";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import { createPlanningService } from "./planning";
import { createPlanningQueries } from "./planning-queries";
import { createSearchService } from "./search";
import { createSprintQueries } from "./sprint-queries";
import { createSprintService } from "./sprints";
import { createTodoService } from "./todos";

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
