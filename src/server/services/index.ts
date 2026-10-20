import { db, runAtomic } from "@/server/db/client";

import { createCommentService } from "./comments";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";
import { createPlanningService } from "./planning";
import { createPlanningQueries } from "./planning-queries";
import { createSearchService } from "./search";
import { createTodoService } from "./todos";

// Wiring only: the real Neon database for the app. Tests build the same services on a
// node-postgres handle (src/test/db.ts).
export const issueService = createIssueService(db, { runAtomic });
export const issueQueries = createIssueQueries(db);
export const commentService = createCommentService(db, { runAtomic });
export const planningService = createPlanningService(db);
export const planningQueries = createPlanningQueries(db);
export const todoService = createTodoService(db);
export const searchService = createSearchService(db);
