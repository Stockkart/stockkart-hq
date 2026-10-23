import { and, asc, desc, eq, isNull, type SQL, sql } from "drizzle-orm";
import { alias as pgAlias } from "drizzle-orm/pg-core";

import { type DocType } from "@/lib/docs/constants";
import { handbookPathFor, isHandbookPath } from "@/lib/docs/handbook-path";
import { handbookSyncStatus } from "@/lib/handbook/sync-state";
import { type HandbookDocSync, type HandbookPublicationView } from "@/lib/handbook/views";
import { docs, handbookPublicationDocs, handbookPublications, users } from "@/server/db/schema";
import { directRead, type Read } from "@/server/db/read-batch";
import { type AppDatabase } from "@/server/db/types";

import { type QueryOptions } from "./issue-queries";
import { type IdRef } from "./sql";

/**
 * Read side of the handbook sync (DOC-14): stored state only, never a GitHub call, so the
 * doc page and the settings tab stay at one round trip (README "Performance").
 */

/** The columns every sync view needs, with the doc's open publication (at most one). */
function syncSelect(db: AppDatabase) {
  return db
    .select({
      id: docs.id,
      title: docs.title,
      type: docs.type,
      adrNumber: docs.adrNumber,
      version: docs.version,
      sourcePath: docs.sourcePath,
      handbookPath: docs.handbookPath,
      editedInHq: sql<boolean>`${docs.updatedBy} IS NOT NULL`,
      handbookBlobSha: docs.handbookBlobSha,
      handbookSyncedVersion: docs.handbookSyncedVersion,
      handbookSyncedAt: docs.handbookSyncedAt,
      handbookRemoteSha: docs.handbookRemoteSha,
      handbookRemoteSeenAt: docs.handbookRemoteSeenAt,
      openPublicationId: handbookPublications.id,
      prNumber: handbookPublications.prNumber,
      prUrl: handbookPublications.prUrl,
    })
    .from(docs)
    .leftJoin(
      handbookPublicationDocs,
      and(eq(handbookPublicationDocs.docId, docs.id), eq(handbookPublicationDocs.open, true)),
    )
    .leftJoin(
      handbookPublications,
      eq(handbookPublications.id, handbookPublicationDocs.publicationId),
    );
}

interface SyncRow {
  id: string;
  title: string;
  type: DocType;
  adrNumber: number | null;
  version: number;
  sourcePath: string | null;
  handbookPath: string | null;
  editedInHq: boolean;
  handbookBlobSha: string | null;
  handbookSyncedVersion: number | null;
  handbookSyncedAt: Date | null;
  handbookRemoteSha: string | null;
  handbookRemoteSeenAt: Date | null;
  openPublicationId: string | null;
  prNumber: number | null;
  prUrl: string | null;
}

/** The import's group pages ("Handbook" = `.`, "Decisions" = `decisions`) are not files. */
export function isImportGroup(doc: { sourcePath: string | null; handbookPath: string | null }) {
  return doc.handbookPath === null && doc.sourcePath !== null && !isHandbookPath(doc.sourcePath);
}

export function toDocSync(row: SyncRow): HandbookDocSync {
  const openPr = row.openPublicationId !== null ? { number: row.prNumber, url: row.prUrl } : null;
  return {
    docId: row.id,
    title: row.title,
    type: row.type,
    path: handbookPathFor(row),
    status: handbookSyncStatus({ ...row, openPr }),
    version: row.version,
    syncedVersion: row.handbookSyncedVersion,
    syncedAt: row.handbookSyncedAt,
    remoteSeenAt: row.handbookRemoteSeenAt,
    pr: openPr,
  };
}

export function createHandbookQueries(db: AppDatabase, { read = directRead }: QueryOptions = {}) {
  const run: Read = read;
  const live = (projectId: IdRef, extra?: SQL) =>
    and(eq(docs.projectId, projectId), isNull(docs.deletedAt), extra);

  return {
    /** The doc page's badge and actions (same batch as the page's other reads). */
    async docSync(projectId: IdRef, docId: string): Promise<HandbookDocSync | null> {
      const [row] = await run(
        syncSelect(db)
          .where(live(projectId, eq(docs.id, docId)))
          .limit(1),
      );
      if (!row || isImportGroup(row)) return null;
      return toDocSync(row);
    },

    /** Settings → Handbook: every live doc that is (or can become) a handbook file. */
    async listDocs(projectId: IdRef): Promise<HandbookDocSync[]> {
      const rows = await run(syncSelect(db).where(live(projectId)).orderBy(asc(docs.id)));
      return rows
        .filter((row) => !isImportGroup(row))
        .map(toDocSync)
        .sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase()));
    },

    /** The latest publications with their PR links (Settings → Handbook). */
    async recentPublications(projectId: IdRef, limit = 20): Promise<HandbookPublicationView[]> {
      const creator = pgAlias(users, "creator");
      return run(
        db
          .select({
            id: handbookPublications.id,
            branch: handbookPublications.branch,
            state: handbookPublications.state,
            prNumber: handbookPublications.prNumber,
            prUrl: handbookPublications.prUrl,
            errorCode: handbookPublications.errorCode,
            createdAt: handbookPublications.createdAt,
            mergedAt: handbookPublications.mergedAt,
            createdByName: creator.name,
            docCount: sql<number>`(SELECT count(*)::int FROM handbook_publication_docs pd
              WHERE pd.publication_id = ${handbookPublications.id})`.mapWith(Number),
          })
          .from(handbookPublications)
          .leftJoin(creator, eq(creator.id, handbookPublications.createdBy))
          .where(eq(handbookPublications.projectId, projectId))
          .orderBy(desc(handbookPublications.createdAt), desc(handbookPublications.id))
          .limit(limit),
      );
    },
  };
}

export type HandbookQueries = ReturnType<typeof createHandbookQueries>;
