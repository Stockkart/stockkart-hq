import { z } from "zod";

import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import { withSession } from "@/server/auth/require-session";
import { docExportQueries } from "@/server/services";

/**
 * DOC-12 "Export .md": `GET /<KEY>/docs/<id>/export` downloads the doc as its handbook
 * Markdown file (`lib/docs/markdown-export.ts`), named like its repo file
 * (`ARCHITECTURE.md`, `0011-….md`).
 *
 * Auth: the proxy already sends anonymous requests to /login (default deny); `withSession`
 * calls `requireSession()` again here (S-2) and answers 401 without one. Every signed-in
 * user may read every doc (SPEC §2), so no further check. A bad key or id, a missing, deleted
 * or other-project doc are all the same 404. Never cached: docs are private (S-7).
 */

const docId = z.uuid();

const NO_STORE = { "Cache-Control": "no-store" } as const;

function notFound(): Response {
  return Response.json(
    { error: "not_found", message: "Doc not found" },
    { status: 404, headers: NO_STORE },
  );
}

export const GET = withSession(
  async (
    _session,
    _request: Request,
    context: { params: Promise<{ projectKey: string; id: string }> },
  ) => {
    const { projectKey, id } = await context.params;
    const key = projectKey.toUpperCase();
    const parsed = docId.safeParse(id);
    if (!PROJECT_KEY_PATTERN.test(key) || !parsed.success) return notFound();
    const file = await docExportQueries.markdownFile(key, parsed.data.toLowerCase());
    if (!file) return notFound();
    return new Response(file.markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        // The name is a validated handbook file name (ASCII letters, digits, `_.-` only),
        // so it needs no quoting beyond the quotes.
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        ...NO_STORE,
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);
