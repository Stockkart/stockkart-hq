import { db, runAtomic } from "@/server/db/client";

import { createCommentService } from "./comments";
import { createDocQueries } from "./doc-queries";
import { createDocService } from "./docs";
import { createIssueQueries } from "./issue-queries";
import { createIssueService } from "./issues";

// Wiring only: the real Neon database for the app. Tests build the same services on a
// node-postgres handle (src/test/db.ts).
export const issueService = createIssueService(db, { runAtomic });
export const issueQueries = createIssueQueries(db);
export const commentService = createCommentService(db, { runAtomic });
export const docService = createDocService(db, { runAtomic });
export const docQueries = createDocQueries(db);
