import { monthCsv, yearCsv } from "@/lib/costs/csv";
import {
  addMonths,
  isMonth,
  isYear,
  localDate,
  type Month,
  periodToMonth,
} from "@/lib/costs/month";
import { PROJECT_KEY_PATTERN } from "@/lib/issues/keys";
import { withSession } from "@/server/auth/require-session";
import { costQueries, issueQueries } from "@/server/services";
import { projectIdByKey } from "@/server/services/sql";

/**
 * COST-5 "Export CSV": `GET /<KEY>/costs/export?month=YYYY-MM` (one month) or `?year=YYYY`
 * (the 12-month grid). Auth: the proxy already sends anonymous requests to /login
 * (default deny); `withSession` calls `requireSession()` again here (S-2) and answers 401
 * without one. Never cached (`no-store`): costs are private. Nothing is logged.
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

function problem(status: number, message: string): Response {
  return Response.json({ error: "bad_request", message }, { status, headers: NO_STORE });
}

export const GET = withSession(
  async (_session, request: Request, context: { params: Promise<{ projectKey: string }> }) => {
    const { projectKey } = await context.params;
    const key = projectKey.toUpperCase();
    if (!PROJECT_KEY_PATTERN.test(key)) return problem(404, "Project not found");
    const search = new URL(request.url).searchParams;
    const month = search.get("month");
    const year = Number(search.get("year"));
    const scope: { month: Month } | { year: number } | null = isMonth(month)
      ? { month }
      : isYear(year)
        ? { year }
        : null;
    if (!scope) return problem(400, "Add ?month=YYYY-MM or ?year=YYYY");

    const thisMonth = periodToMonth(localDate(new Date()));
    const projectId = projectIdByKey(key);
    const [from, to] =
      "month" in scope
        ? [addMonths(scope.month, -12), scope.month]
        : [addMonths(`${scope.year}-01` as Month, -11), `${scope.year}-12` as Month];
    // One round trip: everything takes the project by key.
    const [project, items, entries, settings] = await Promise.all([
      issueQueries.getProject(key),
      costQueries.items(projectId),
      costQueries.entriesBetween(projectId, from, to),
      costQueries.settings(projectId),
    ]);
    if (!project) return problem(404, "Project not found");

    const csv =
      "month" in scope
        ? monthCsv({ items, entries, month: scope.month, baseCurrency: settings.baseCurrency })
        : yearCsv({
            items,
            entries,
            year: scope.year,
            baseCurrency: settings.baseCurrency,
            currentMonth: thisMonth,
          });
    const name = `${key.toLowerCase()}-costs-${"month" in scope ? scope.month : scope.year}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        // The name is built from a validated key and month / year only.
        "Content-Disposition": `attachment; filename="${name}"`,
        ...NO_STORE,
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);
