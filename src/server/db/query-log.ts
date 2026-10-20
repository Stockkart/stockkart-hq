import { AsyncLocalStorage } from "node:async_hooks";

import { cache } from "react";
import { z } from "zod";

/**
 * Development aid behind `HQ_LOG_QUERIES=1` (off by default): logs every HTTP round trip
 * to Neon with the number of SQL statements it carried and its time, plus running totals
 * for the current server request. Only counts and timings are logged, never SQL text or
 * parameters, so the log cannot leak data.
 *
 * Hooked in as Neon's `fetchFunction`, so it sees exactly what costs time: one line per
 * round trip, whether it holds one query or a whole `db.batch()`.
 */

export interface RequestDbStats {
  /** Short id that groups the lines of one server request. */
  id: string;
  roundTrips: number;
  statements: number;
  /** Sum of round-trip times (parallel trips overlap, so this can exceed the wall time). */
  totalMs: number;
  /** When this request's first round trip started. */
  startedAt: number | null;
}

const newStats = (): RequestDbStats => ({
  id: Math.random().toString(36).slice(2, 8),
  roundTrips: 0,
  statements: 0,
  totalMs: 0,
  startedAt: null,
});

/** Server actions (outside React's render scope) get theirs from `withRequestStats`. */
const actionStats = new AsyncLocalStorage<RequestDbStats>();
/** One stats object per server render (React `cache` is request-scoped there). */
const renderStats = cache(newStats);
const requestStats = () => actionStats.getStore() ?? renderStats();

/** Runs `fn` with its own stats, so all of an action's round trips add up in one place. */
export function withRequestStats<T>(fn: () => Promise<T>): Promise<T> {
  return actionStats.run(newStats(), fn);
}

const batchBody = z.object({ queries: z.array(z.unknown()) });

/** Statements in one Neon HTTP request body: a `queries` batch, or a single query. */
export function statementCount(body: unknown): number {
  if (typeof body !== "string") return 1;
  try {
    const parsed = batchBody.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data.queries.length : 1;
  } catch {
    return 1;
  }
}

export function createTimedFetch(
  baseFetch: typeof fetch,
  {
    // stdout like the dev server's own request lines (console.info is not allowed by lint).
    log = (line: string) => process.stdout.write(`${line}\n`),
    stats = requestStats,
    now = () => performance.now(),
  }: {
    log?: (line: string) => void;
    stats?: () => RequestDbStats;
    now?: () => number;
  } = {},
): typeof fetch {
  return async (input, init) => {
    // Read the request's stats synchronously, while still in the caller's request scope.
    const current = stats();
    const statements = statementCount(init?.body);
    const start = now();
    current.startedAt ??= start;
    try {
      return await baseFetch(input, init);
    } finally {
      const end = now();
      current.roundTrips += 1;
      current.statements += statements;
      current.totalMs += end - start;
      log(
        `[db] ${current.id} round trip ${current.roundTrips}: ${statements} statement${
          statements === 1 ? "" : "s"
        } in ${Math.round(end - start)} ms · request so far: ${current.roundTrips} round trips, ${
          current.statements
        } statements, ${Math.round(end - (current.startedAt ?? start))} ms wall`,
      );
    }
  };
}
