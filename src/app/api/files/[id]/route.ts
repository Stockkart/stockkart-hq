import { withSession } from "@/server/auth/require-session";
import { fileQueries } from "@/server/services";
import { storage } from "@/server/storage";
import { createFileDownloadHandler } from "@/server/storage/download-route";

/**
 * S-5 attachment download. The proxy already answers 401 to anonymous /api/* requests;
 * `withSession` re-checks here (S-2). A ready, live attachment redirects (302) to a
 * presigned R2 URL valid ≤ 5 minutes; see `download-route.ts`.
 */
const download = createFileDownloadHandler({
  storage,
  find: (id) => fileQueries.readyAttachment(id),
});

export const GET = withSession(
  async (_session, request: Request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    return download(request, id);
  },
);
