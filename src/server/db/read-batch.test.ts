import { type BatchItem } from "drizzle-orm/batch";
import { describe, expect, it, vi } from "vitest";

import { createBatchedRead, directRead, type ReadQuery, type RunBatch } from "./read-batch";

/** A stand-in for a Drizzle builder: runnable alone (thenable) or inside a batch. */
function fakeQuery<R>(value: R, log: string[], name: string): ReadQuery<R> & { value: R } {
  return {
    _: { dialect: "pg", result: value },
    value,
    then(onFulfilled, onRejected) {
      log.push(`alone:${name}`);
      return Promise.resolve(value).then(onFulfilled, onRejected);
    },
  };
}

function failingQuery(log: string[], name: string): ReadQuery<string> {
  return {
    _: { dialect: "pg", result: "" },
    then(onFulfilled, onRejected) {
      log.push(`alone:${name}`);
      return Promise.reject(new Error(`${name} failed`)).then(onFulfilled, onRejected);
    },
  };
}

const valueOf = (item: BatchItem<"pg">) => ("value" in item ? item.value : undefined);

describe("createBatchedRead", () => {
  it("sends the reads of one tick as ONE batch and gives each caller its own result", async () => {
    const log: string[] = [];
    const runBatch = vi.fn<RunBatch>(async (queries) => queries.map(valueOf));
    const read = createBatchedRead(runBatch);
    const [a, b, c] = await Promise.all([
      read(fakeQuery(1, log, "a")),
      read(fakeQuery("two", log, "b")),
      read(fakeQuery([3], log, "c")),
    ]);
    expect([a, b, c]).toEqual([1, "two", [3]]);
    expect(runBatch).toHaveBeenCalledTimes(1);
    expect(runBatch.mock.calls[0]?.[0]).toHaveLength(3);
    expect(log).toEqual([]);
  });

  it("runs a lone read on its own (no batch round trip overhead)", async () => {
    const log: string[] = [];
    const runBatch = vi.fn<RunBatch>(async () => []);
    const read = createBatchedRead(runBatch);
    expect(await read(fakeQuery(7, log, "only"))).toBe(7);
    expect(runBatch).not.toHaveBeenCalled();
    expect(log).toEqual(["alone:only"]);
  });

  it("starts a new batch for reads issued after the previous one was sent", async () => {
    const log: string[] = [];
    const runBatch = vi.fn<RunBatch>(async (queries) => queries.map(valueOf));
    const read = createBatchedRead(runBatch);
    await Promise.all([read(fakeQuery(1, log, "a")), read(fakeQuery(2, log, "b"))]);
    await Promise.all([read(fakeQuery(3, log, "c")), read(fakeQuery(4, log, "d"))]);
    expect(runBatch).toHaveBeenCalledTimes(2);
  });

  it("re-runs each read alone when the batch fails, so only the bad one rejects", async () => {
    const log: string[] = [];
    const runBatch = vi.fn<RunBatch>(async () => {
      throw new Error("transaction aborted");
    });
    const read = createBatchedRead(runBatch);
    const results = await Promise.allSettled([
      read(fakeQuery("ok", log, "good")),
      read(failingQuery(log, "bad")),
    ]);
    expect(results[0]).toEqual({ status: "fulfilled", value: "ok" });
    expect(results[1]).toMatchObject({ status: "rejected", reason: { message: "bad failed" } });
    expect(log.sort()).toEqual(["alone:bad", "alone:good"]);
  });
});

describe("directRead", () => {
  it("runs the query at once", async () => {
    const log: string[] = [];
    expect(await directRead(fakeQuery(5, log, "q"))).toBe(5);
    expect(log).toEqual(["alone:q"]);
  });
});
