import { type DigestJob } from "./digest";
import { escapeHtml } from "./html";
import { isUnsubscribeToken, verifyCronAuthorization } from "./tokens";
import { type UnsubscribeService } from "./unsubscribe";

/**
 * NTF-2 route handlers as factories (the files under `app/` only wire them), so the auth
 * rules are unit-tested. Both routes are public in the proxy (exact paths in
 * `access-policy.ts`) and authenticate requests themselves; neither is a server action.
 */

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * `/api/cron/digest`. Vercel Cron calls the path with GET and `Authorization: Bearer
 * <CRON_SECRET>` (https://vercel.com/docs/cron-jobs, ".../manage-cron-jobs", checked
 * 2026-10-22); POST does the same for a manual run (`curl -X POST -H "Authorization: …"`).
 *
 *   1. no CRON_SECRET          → 503, nothing runs (fail closed)
 *   2. missing / wrong secret  → 401 (constant-time compare)
 *   3. email not configured    → 503, nothing is sent
 *   4. run the job             → 200 with counts only
 */
export function createCronDigestHandler(deps: {
  secret: () => string | undefined;
  job: () => DigestJob | null;
}) {
  return async (request: Request): Promise<Response> => {
    const secret = deps.secret();
    if (!secret) return json(503, { error: "not_configured", message: "CRON_SECRET is not set" });
    if (!verifyCronAuthorization(secret, request.headers.get("authorization"))) {
      return json(401, { error: "unauthorized" });
    }
    const job = deps.job();
    if (!job) return json(503, { error: "email_not_configured", message: "Email isn't set up" });
    return json(200, { ok: true, ...(await job.run()) });
  };
}

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)} · Stockkart HQ</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">
<main><h1 style="font-size:1.25rem">${escapeHtml(title)}</h1>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // The token is in the URL: never send it on as a referrer.
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}

/**
 * `/unsubscribe?token=…` (RFC 8058). GET only shows a confirmation form (link scanners and
 * prefetchers fetch with GET, so GET never changes anything and never touches the
 * database); POST unsubscribes, from that form or from a mail client's one-click request
 * (`List-Unsubscribe=One-Click` body, token in the URL). The answer is the same whether or
 * not the token matched anyone, and no account detail is ever shown.
 */
export function createUnsubscribeHandlers(deps: {
  service: () => Pick<UnsubscribeService, "unsubscribe">;
  clientIp: (headers: Headers) => string;
}) {
  return {
    GET(request: Request): Response {
      const token = new URL(request.url).searchParams.get("token");
      if (!isUnsubscribeToken(token)) {
        return page(
          400,
          "Link incomplete",
          "<p>This unsubscribe link is not complete. Open it from the email again, or turn the digest off in Settings → Profile in HQ.</p>",
        );
      }
      // The token is URL-safe base64 (checked above) and escaped anyway.
      const action = `/unsubscribe?token=${escapeHtml(token)}`;
      return page(
        200,
        "Unsubscribe?",
        `<p>Stop the Stockkart HQ email digest?</p>
<form method="post" action="${action}"><button type="submit" style="font:inherit;padding:.4rem .9rem">Unsubscribe</button></form>`,
      );
    },

    async POST(request: Request): Promise<Response> {
      const token = new URL(request.url).searchParams.get("token") ?? "";
      const outcome = await deps.service().unsubscribe(token, deps.clientIp(request.headers));
      if (outcome === "rate_limited") {
        return page(
          429,
          "Try again later",
          "<p>Too many attempts. Wait a few minutes and try again.</p>",
        );
      }
      return page(
        200,
        "Unsubscribed",
        "<p>If this link was valid, you will get no more digest emails. You can turn them back on in Settings → Profile in HQ.</p>",
      );
    },
  };
}
