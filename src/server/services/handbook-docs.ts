import { and, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { alias as pgAlias } from "drizzle-orm/pg-core";

import { type AdrStatus, type DocType } from "@/lib/docs/constants";
import { handbookPathFor } from "@/lib/docs/handbook-path";
import { docToMarkdown } from "@/lib/docs/markdown-export";
import { type RichTextDoc } from "@/lib/rich-text";
import { docs, handbookPublicationDocs, handbookPublications, projects } from "@/server/db/schema";
import { type Read } from "@/server/db/read-batch";
import { type AppDatabase } from "@/server/db/types";

import { isImportGroup } from "./handbook-queries";

/**
 * The docs a publish, pull or check works on: content, the ADR successor (for the Status
 * line), the sync columns and the open publication. Live docs of live projects only.
 */
export interface HandbookDocRow {
  id: string;
  projectId: string;
  projectKey: string;
  type: DocType;
  title: string;
  content: RichTextDoc | null;
  version: number;
  adrNumber: number | null;
  adrStatus: AdrStatus | null;
  sourcePath: string | null;
  handbookPath: string | null;
  editedInHq: boolean;
  handbookBlobSha: string | null;
  handbookSyncedVersion: number | null;
  handbookRemoteSha: string | null;
  handbookRemoteSeenAt: Date | null;
  successorTitle: string | null;
  successorNumber: number | null;
  successorHandbookPath: string | null;
  successorSourcePath: string | null;
  openPublicationId: string | null;
  openPrUrl: string | null;
}

export async function loadHandbookDocs(
  db: AppDatabase,
  read: Read,
  where: { docIds: readonly string[] } | { projectKey: string },
): Promise<HandbookDocRow[]> {
  const successor = pgAlias(docs, "successor");
  const filter: SQL | undefined =
    "docIds" in where ? inArray(docs.id, [...where.docIds]) : eq(projects.key, where.projectKey);
  const rows = await read(
    db
      .select({
        id: docs.id,
        projectId: docs.projectId,
        projectKey: projects.key,
        type: docs.type,
        title: docs.title,
        content: docs.content,
        version: docs.version,
        adrNumber: docs.adrNumber,
        adrStatus: docs.adrStatus,
        sourcePath: docs.sourcePath,
        handbookPath: docs.handbookPath,
        editedInHq: sql<boolean>`${docs.updatedBy} IS NOT NULL`,
        handbookBlobSha: docs.handbookBlobSha,
        handbookSyncedVersion: docs.handbookSyncedVersion,
        handbookRemoteSha: docs.handbookRemoteSha,
        handbookRemoteSeenAt: docs.handbookRemoteSeenAt,
        successorTitle: successor.title,
        successorNumber: successor.adrNumber,
        successorHandbookPath: successor.handbookPath,
        successorSourcePath: successor.sourcePath,
        openPublicationId: handbookPublications.id,
        openPrUrl: handbookPublications.prUrl,
      })
      .from(docs)
      .innerJoin(projects, and(eq(projects.id, docs.projectId), isNull(projects.archivedAt)))
      .leftJoin(successor, and(eq(successor.id, docs.adrSupersededBy), isNull(successor.deletedAt)))
      .leftJoin(
        handbookPublicationDocs,
        and(eq(handbookPublicationDocs.docId, docs.id), eq(handbookPublicationDocs.open, true)),
      )
      .leftJoin(
        handbookPublications,
        eq(handbookPublications.id, handbookPublicationDocs.publicationId),
      )
      .where(and(filter, isNull(docs.deletedAt))),
  );
  return rows.filter((row) => !isImportGroup(row));
}

/** The repo path: the override from the dialog, else `handbookPathFor`. */
export function pathOf(row: HandbookDocRow, override?: string): string {
  return override ?? handbookPathFor(row);
}

/** The doc as its handbook file (DOC-12 export), written to `path`. */
export function markdownOf(row: HandbookDocRow, path: string): string {
  return docToMarkdown({
    type: row.type,
    title: row.title,
    content: row.content,
    projectKey: row.projectKey,
    adrNumber: row.adrNumber,
    adrStatus: row.adrStatus,
    handbookPath: path,
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
  }).markdown;
}
