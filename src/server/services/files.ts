import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { type AttachmentView } from "@/lib/attachments/views";
import { directRead, type Read } from "@/server/db/read-batch";
import { attachments, diagrams, users } from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

import { liveAttachmentParent } from "./attachments";
import { type IdRef } from "./sql";

/** What `/api/files/*` needs to sign a download. */
export interface StoredFile {
  storageKey: string;
  filename: string;
  mime: string;
}

/**
 * Lookups for the authenticated file routes (S-5) and the attachments panel (ISS-9). Only
 * servable objects come back: an attachment that is `ready`, not deleted and whose parent
 * (issue, doc, or comment and its issue/doc) is not deleted either; a thumbnail of a live
 * diagram. The route answers 404 for everything else, so pending uploads and trash are never
 * downloadable.
 */
export function createFileQueries(db: AppDatabase, { read = directRead }: { read?: Read } = {}) {
  return {
    async readyAttachment(id: string): Promise<StoredFile | null> {
      const [row] = await read(
        db
          .select({
            storageKey: attachments.storageKey,
            filename: attachments.filename,
            mime: attachments.mime,
          })
          .from(attachments)
          .where(
            and(
              eq(attachments.id, id),
              eq(attachments.status, "ready"),
              isNull(attachments.deletedAt),
              liveAttachmentParent(sql`${attachments.entityType}`, sql`${attachments.entityId}`),
            ),
          )
          .limit(1),
      );
      return row ?? null;
    },

    /**
     * The attachments panel of an issue or a doc: ready, undeleted files, oldest first. No
     * storage key: the UI only ever links `/api/files/<id>`.
     */
    async listAttachments(entityType: "issue" | "doc", entityId: IdRef): Promise<AttachmentView[]> {
      return read(
        db
          .select({
            id: attachments.id,
            entityType: attachments.entityType,
            entityId: attachments.entityId,
            filename: attachments.filename,
            mime: attachments.mime,
            sizeBytes: attachments.sizeBytes,
            width: attachments.width,
            height: attachments.height,
            uploadedBy: attachments.uploadedBy,
            uploaderName: users.name,
            createdAt: attachments.createdAt,
          })
          .from(attachments)
          .leftJoin(users, eq(users.id, attachments.uploadedBy))
          .where(
            and(
              eq(attachments.entityType, entityType),
              eq(attachments.entityId, entityId),
              eq(attachments.status, "ready"),
              isNull(attachments.deletedAt),
            ),
          )
          .orderBy(asc(attachments.createdAt), asc(attachments.id)),
      );
    },

    /** DGM-5: the PNG thumbnail of a live diagram, if one was saved. */
    async diagramThumbnail(id: string): Promise<StoredFile | null> {
      const [row] = await read(
        db
          .select({ thumbnailKey: diagrams.thumbnailKey })
          .from(diagrams)
          .where(
            and(eq(diagrams.id, id), isNull(diagrams.deletedAt), isNotNull(diagrams.thumbnailKey)),
          )
          .limit(1),
      );
      if (!row?.thumbnailKey) return null;
      return { storageKey: row.thumbnailKey, filename: `diagram-${id}.png`, mime: "image/png" };
    },
  };
}

export type FileQueries = ReturnType<typeof createFileQueries>;
