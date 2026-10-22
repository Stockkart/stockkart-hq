import { classifyUpload, type Disposition } from "@/lib/attachments/policy";
import { type StoredFile } from "@/server/services/files";

import { STORAGE_NOT_CONFIGURED_MESSAGE, StorageNotConfigured } from "./errors";
import { isUuid } from "./keys";
import { type Storage } from "./storage";

/**
 * The body of the authenticated file routes (S-5): `/api/files/[id]` (attachments) and
 * `/api/files/thumbnail/diagram/[id]` (DGM-5). The route wraps it in `withSession`, so it
 * only ever runs for a signed-in user; it then redirects to a presigned GET that expires in
 * ≤ 5 minutes. The bucket itself is never public.
 *
 *   302  the file exists and is servable → Location: presigned URL
 *   404  bad id, unknown, pending or deleted (indistinguishable on purpose)
 *   503  storage is not configured
 *
 * `?download=1` asks for `attachment` and `?inline=1` for `inline`; otherwise the policy's
 * default applies (images inline, everything else downloads). The policy can only make it
 * stricter, never looser.
 */
export function createFileDownloadHandler(deps: {
  storage: Pick<Storage, "storageConfigured" | "presignDownload">;
  find: (id: string) => Promise<StoredFile | null>;
}) {
  return async (request: Request, id: string): Promise<Response> => {
    if (!isUuid(id)) return notFoundResponse();
    if (!deps.storage.storageConfigured()) return notConfiguredResponse();
    const file = await deps.find(id.toLowerCase());
    if (!file) return notFoundResponse();
    const params = new URL(request.url).searchParams;
    // `?download=1` forces a download; `?inline=1` asks to view (PDFs). The policy in
    // `presignDownload` still downgrades `inline` for every type that may not be shown.
    const disposition: Disposition =
      params.get("download") === "1"
        ? "attachment"
        : params.get("inline") === "1"
          ? "inline"
          : classifyUpload(file.mime, file.filename).defaultDisposition;
    let location: string;
    try {
      location = await deps.storage.presignDownload({
        key: file.storageKey,
        filename: file.filename,
        disposition,
        contentType: file.mime,
      });
    } catch (error) {
      if (error instanceof StorageNotConfigured) return notConfiguredResponse();
      throw error;
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: location,
        // The signed URL is per user and short-lived: never cache the redirect, and never
        // send it on as a Referer.
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  };
}

function notFoundResponse(): Response {
  return Response.json(
    { error: "not_found", message: "File not found" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

function notConfiguredResponse(): Response {
  return Response.json(
    { error: "not_configured", message: STORAGE_NOT_CONFIGURED_MESSAGE },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
