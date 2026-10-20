import { type BatchItem } from "drizzle-orm/batch";
import { type RunnableQuery } from "drizzle-orm/runnable-query";

/**
 * Read fan-out in ONE round trip.
 *
 * Neon's HTTP driver pays a full HTTPS round trip per query (~180 ms from this region), so
 * a page that runs eight independent queries in `Promise.all` still opens up to eight
 * requests (and, after the keep-alive idle timeout, eight TLS handshakes). `db.batch()`
 * sends many statements in one request, but only if the caller has them all at hand.
 *
 * `read(query)` gives the query modules that without restructuring: every read started in
 * the same tick (typically one `Promise.all`, or a layout and its page, which render in
 * parallel) is queued and sent together as one `db.batch()` on the next turn of the event
 * loop. Each caller gets its own query's result. Only reads go through here; writes keep
 * calling the database directly, so they are never batched with anything.
 *
 * A batch is one non-interactive transaction, so one failing statement fails them all. In
 * that case every query is re-run on its own, so each caller sees its own result or error
 * exactly as without batching (costs one extra round trip, on the error path only).
 */

/** A Drizzle query builder (select, raw `execute`, …): runnable on its own or in a batch. */
export type ReadQuery<R> = RunnableQuery<R, "pg"> & PromiseLike<R>;

export type Read = <R>(query: ReadQuery<R>) => Promise<R>;

export type RunBatch = (
  queries: readonly [BatchItem<"pg">, ...BatchItem<"pg">[]],
) => Promise<readonly unknown[]>;

/** No batching: runs the query at once. node-postgres (tests, scripts) and the default. */
export const directRead: Read = (query) => Promise.resolve(query);

interface Pending {
  query: BatchItem<"pg">;
  deliver: (result: unknown) => void;
  runAlone: () => void;
}

export function createBatchedRead(
  runBatch: RunBatch,
  schedule: (flush: () => void) => void = (flush) => setImmediate(flush),
): Read {
  let queue: Pending[] = [];

  function flush() {
    const items = queue;
    queue = [];
    const [first, ...rest] = items;
    if (!first) return;
    if (rest.length === 0) {
      first.runAlone();
      return;
    }
    runBatch([first.query, ...rest.map((item) => item.query)]).then(
      (results) => items.forEach((item, index) => item.deliver(results[index])),
      // Which statement failed is not reported per query: re-run each on its own.
      () => items.forEach((item) => item.runAlone()),
    );
  }

  return <R>(query: ReadQuery<R>) =>
    new Promise<R>((resolve, reject) => {
      queue.push({
        query,
        // db.batch() returns, in order, the result each builder would have returned when
        // awaited on its own (same mapping), so this result has the builder's type R.
        deliver: (result) => resolve(result as R),
        runAlone: () => {
          Promise.resolve(query).then(resolve, reject);
        },
      });
      if (queue.length === 1) schedule(flush);
    });
}
