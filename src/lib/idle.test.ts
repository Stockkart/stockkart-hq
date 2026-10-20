// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { preloader, whenIdle } from "./idle";

describe("preloader", () => {
  it("loads once and shares the promise", async () => {
    const load = vi.fn(async () => "data");
    const get = preloader(load);
    const [a, b] = await Promise.all([get(), get()]);
    expect([a, b]).toEqual(["data", "data"]);
    await get();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("forgets a failure so the next call retries", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("data");
    const get = preloader(load);
    await expect(get()).rejects.toThrow("offline");
    await expect(get()).resolves.toBe("data");
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("whenIdle", () => {
  it("runs the task later (timer fallback without requestIdleCallback) and can be cancelled", () => {
    vi.useFakeTimers();
    try {
      const ran = vi.fn();
      whenIdle(ran);
      const cancelled = vi.fn();
      const cancel = whenIdle(cancelled);
      cancel();
      expect(ran).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(ran).toHaveBeenCalledTimes(1);
      expect(cancelled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
