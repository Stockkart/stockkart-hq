import { withSession } from "@/server/auth/require-session";
import { fileQueries } from "@/server/services";
import { storage } from "@/server/storage";
import { createFileDownloadHandler } from "@/server/storage/download-route";

/**
 * DGM-5 diagram thumbnail, behind the same session check and presigned redirect as
 * attachments (S-5): thumbnails show private diagrams, so they are never public either.
 */
const download = createFileDownloadHandler({
  storage,
  find: (id) => fileQueries.diagramThumbnail(id),
});

export const GET = withSession(
  async (_session, request: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    return download(request, id);
  },
);
