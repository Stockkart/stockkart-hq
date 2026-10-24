import { type CostRoute, entriesRange } from "@/lib/costs/route";
import { type Month } from "@/lib/costs/month";

import { type CostQueries } from "./costs";
import { type IdRef } from "./sql";

/**
 * Exactly the reads /<KEY>/costs starts for a tab, shared by the page and its round-trip
 * test (cost-pages.db.test.ts), so the test counts what the page runs. All take the
 * project as an `IdRef`, so with the app layout's reads they are ONE round trip.
 */
export function costPageReads(
  queries: CostQueries,
  projectId: IdRef,
  route: CostRoute,
  today: { date: string; month: Month },
) {
  const range = entriesRange(route, today.month);
  return [
    queries.items(projectId),
    queries.entriesBetween(projectId, range.from, range.to),
    queries.settings(projectId),
    queries.reminder(projectId, today.date),
    queries.serviceOptions(projectId),
    queries.userOptions(),
  ] as const;
}
