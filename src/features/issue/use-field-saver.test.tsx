// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type FieldValue, useFieldSaver } from "./use-field-saver";

type Field = "status" | "priority";

describe("useFieldSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (save: (field: Field, value: FieldValue) => Promise<boolean>) =>
    renderHook(
      ({ server }: { server: Record<Field, FieldValue> }) => useFieldSaver<Field>(server, save),
      { initialProps: { server: { status: "todo", priority: 2 } } },
    );

  it("collapses rapid changes (arrow keys on a select) into one save of the last value", async () => {
    const save = vi.fn(async () => true);
    const { result } = setup(save);
    act(() => {
      result.current.change("status", "backlog");
      result.current.change("status", "in-progress");
      result.current.change("status", "done");
    });
    expect(result.current.valueOf("status")).toBe("done");
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("status", "done");
  });

  it("saves at once on blur (flush) and when immediate", async () => {
    const save = vi.fn(async () => true);
    const { result } = setup(save);
    act(() => result.current.change("priority", 0));
    await act(async () => result.current.flush("priority"));
    expect(save).toHaveBeenCalledWith("priority", 0);
    await act(async () => result.current.change("status", "done", { immediate: true }));
    expect(save).toHaveBeenCalledWith("status", "done");
  });

  it("runs saves of one field in order and reverts to the server value on failure", async () => {
    const calls: FieldValue[] = [];
    let release: (ok: boolean) => void = () => {};
    const save = vi.fn(
      (_field: Field, value: FieldValue) =>
        new Promise<boolean>((resolve) => {
          calls.push(value);
          release = resolve;
        }),
    );
    const { result } = setup(save);
    await act(async () => result.current.change("priority", 1, { immediate: true }));
    await act(async () => result.current.change("priority", 0, { immediate: true }));
    // The second save waits for the first.
    expect(calls).toEqual([1]);
    await act(async () => release(true));
    expect(calls).toEqual([1, 0]);
    await act(async () => release(false));
    expect(result.current.valueOf("priority")).toBe(2);
  });

  it("shows server values once they change and nothing is pending", () => {
    const { result, rerender } = setup(vi.fn(async () => true));
    rerender({ server: { status: "done", priority: 3 } });
    expect(result.current.valueOf("status")).toBe("done");
    expect(result.current.valueOf("priority")).toBe(3);
  });
});
