import { and, eq, isNull } from "drizzle-orm";
import { alias as pgAlias } from "drizzle-orm/pg-core";

import { docToMarkdown, type MarkdownExport } from "@/lib/docs/markdown-export";
import { docs, projects } from "@/server/db/schema";
import { directRead } from "@/server/db/read-batch";
import { type AppDatabase } from "@/server/db/types";

import { type QueryOptions } from "./issue-queries";

/**
 * DOC-12 "Export .md": a doc as its handbook Markdown file. One query (the doc, its project
 * key and its live successor ADR); the Markdown itself is pure (`lib/docs/markdown-export`).
 */
export function createDocExportQueries(db: AppDatabase, { read = directRead }: QueryOptions = {}) {
  return {
    /** A live doc of a live project, or null (missing, deleted or in another project). */
    async markdownFile(projectKey: string, docId: string): Promise<MarkdownExport | null> {
      const successor = pgAlias(docs, "successor");
      const [row] = await read(
        db
          .select({
            type: docs.type,
            title: docs.title,
            content: docs.content,
            adrNumber: docs.adrNumber,
            adrStatus: docs.adrStatus,
            handbookPath: docs.handbookPath,
            sourcePath: docs.sourcePath,
            projectKey: projects.key,
            successorTitle: successor.title,
            successorNumber: successor.adrNumber,
            successorHandbookPath: successor.handbookPath,
            successorSourcePath: successor.sourcePath,
          })
          .from(docs)
          .innerJoin(
            projects,
            and(
              eq(projects.id, docs.projectId),
              eq(projects.key, projectKey),
              isNull(projects.archivedAt),
            ),
          )
          .leftJoin(
            successor,
            and(eq(successor.id, docs.adrSupersededBy), isNull(successor.deletedAt)),
          )
          .where(and(eq(docs.id, docId), isNull(docs.deletedAt)))
          .limit(1),
      );
      if (!row) return null;
      return docToMarkdown({
        type: row.type,
        title: row.title,
        content: row.content,
        projectKey: row.projectKey,
        adrNumber: row.adrNumber,
        adrStatus: row.adrStatus,
        handbookPath: row.handbookPath,
        sourcePath: row.sourcePath,
        supersededBy:
          row.successorTitle !== null
            ? {
                title: row.successorTitle,
                adrNumber: row.successorNumber,
                handbookPath: row.successorHandbookPath,
                sourcePath: row.successorSourcePath,
              }
            : null,
      });
    },
  };
}
