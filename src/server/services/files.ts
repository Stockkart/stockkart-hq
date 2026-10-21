import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { directRead, type Read } from "@/server/db/read-batch";
import { attachments, diagrams } from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

/** What `/api/files/*` needs to sign a download. */
export interface StoredFile {
  storageKey: string;
  filename: string;
  mime: string;
}

/**
 * Lookups for the authenticated file routes (S-5). Only servable objects come back: an
 * attachment that is `ready` and not deleted, a thumbnail of a live diagram. The route
 * answers 404 for everything else, so pending uploads and trash are never downloadable.
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
            ),
          )
          .limit(1),
      );
      return row ?? null;
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
