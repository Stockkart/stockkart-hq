import { verifyCronAuthorization } from "@/server/email/tokens";
import { type CostReminderJob } from "@/server/services/costs";

/**
 * `/api/cron/monthly` (COST-7) as a factory (the file under `app/` only wires it), so the
 * auth rules are unit-tested. Public in the proxy as an EXACT path (`access-policy.ts`)
 * because Vercel Cron holds no session; the route authenticates every request itself, the
 * same way as `/api/cron/digest`:
 *
 *   1. no CRON_SECRET          → 503, nothing runs (fail closed)
 *   2. missing / wrong secret  → 401 (`verifyCronAuthorization`, constant-time compare)
 *   3. run the jobs            → 200 with counts only (never amounts or names)
 *
 * Vercel calls it daily (vercel.json, 03:00 UTC) with GET; POST is the same, for a manual
 * run. Each job decides itself whether today is its day (the reminder day per project),
 * and is idempotent, so extra runs are harmless.
 */

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createCronMonthlyHandler(deps: {
  secret: () => string | undefined;
  costReminders: () => Pick<CostReminderJob, "run">;
}) {
  return async (request: Request): Promise<Response> => {
    const secret = deps.secret();
    if (!secret) return json(503, { error: "not_configured", message: "CRON_SECRET is not set" });
    if (!verifyCronAuthorization(secret, request.headers.get("authorization"))) {
      return json(401, { error: "unauthorized" });
    }
    const costReminders = await deps.costReminders().run();
    return json(200, { ok: true, costReminders });
  };
}
