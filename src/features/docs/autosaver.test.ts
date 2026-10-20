import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rt } from "@/lib/rich-text";

import {
  AUTOSAVE_DELAY_MS,
  DocAutosaver,
  type SaveRequest,
  type SaveResponse,
  type SaverState,
} from "./autosaver";

const doc = (text: string) => rt.doc(rt.paragraph(text));

function setup(responses: ((request: SaveRequest) => SaveResponse)[]) {
  const requests: SaveRequest[] = [];
  const states: SaverState[] = [];
  const onSaved = vi.fn();
  const save = vi.fn(async (request: SaveRequest) => {
    requests.push(request);
    const next = responses.shift();
    if (!next) throw new Error("unexpected save");
    return next(request);
  });
  const saver = new DocAutosaver(
    { version: 4, content: doc("start"), title: "Title" },
    { save, onState: (state) => states.push(state), onSaved },
  );
  return { saver, save, requests, states, onSaved };
}

const savedAs = (version: number) => (): SaveResponse => ({ status: "saved", version });

describe("DocAutosaver (§7.4)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces changes and saves once with the base version", async () => {
    const { saver, save, requests } = setup([savedAs(5)]);
    saver.change({ content: doc("a") });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    saver.change({ content: doc("ab") });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toEqual([
      { baseVersion: 4, content: doc("ab"), title: undefined, snapshot: false },
    ]);
    expect(saver.current).toMatchObject({ status: "saved", version: 5 });
    expect(saver.hasUnsavedChanges).toBe(false);
  });

  it("sends the title only when it changed, and continues from the new version", async () => {
    const { saver, requests, onSaved } = setup([savedAs(5), savedAs(6)]);
    saver.change({ title: "Renamed" });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    saver.change({ content: doc("body") });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(requests.map((request) => [request.baseVersion, request.title])).toEqual([
      [4, "Renamed"],
      [5, undefined],
    ]);
    expect(onSaved.mock.calls.map(([saved]) => saved.titleChanged)).toEqual([true, false]);
  });

  it("detects a conflict, stops autosaving, and Keep mine re-bases on the winner", async () => {
    const latest = { version: 7, title: "Title", content: doc("theirs"), updatedByName: "RK" };
    const { saver, requests } = setup([() => ({ status: "conflict", latest }), savedAs(8)]);
    saver.change({ content: doc("mine") });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saver.current).toMatchObject({ status: "conflict", conflict: latest });

    // Typing on does not overwrite while the banner is up.
    saver.change({ content: doc("mine, more") });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
    expect(requests).toHaveLength(1);

    saver.keepMine();
    await vi.advanceTimersByTimeAsync(0);
    expect(requests[1]).toEqual({
      baseVersion: 7,
      content: doc("mine, more"),
      title: "Title",
      snapshot: false,
    });
    expect(saver.current).toMatchObject({ status: "saved", version: 8, conflict: null });
  });

  it("Reload takes the winner's copy and version", async () => {
    const latest = { version: 9, title: "Theirs", content: doc("theirs"), updatedByName: null };
    const { saver, requests } = setup([() => ({ status: "conflict", latest }), savedAs(10)]);
    saver.change({ content: doc("mine") });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saver.mine.content).toEqual(doc("mine"));
    expect(saver.reload()).toEqual(latest);
    expect(saver.current).toMatchObject({ status: "saved", version: 9 });
    saver.change({ content: doc("theirs + mine") });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(requests[1]).toMatchObject({ baseVersion: 9, title: undefined });
  });

  it("Save version saves now with a snapshot; changes during a save are saved after it", async () => {
    let resolveFirst: (response: SaveResponse) => void = () => {};
    const { saver, save, requests } = setup([() => savedAs(5)(), savedAs(6)]);
    save.mockImplementationOnce(async (request) => {
      requests.push(request);
      return new Promise<SaveResponse>((resolve) => (resolveFirst = resolve));
    });
    saver.saveNow(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(requests[0]).toMatchObject({ baseVersion: 4, snapshot: true });
    saver.change({ content: doc("during") });
    resolveFirst({ status: "saved", version: 5 });
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.current.status).toBe("dirty");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(requests[1]).toMatchObject({ baseVersion: 5, content: doc("during"), snapshot: false });
  });

  it("reports a failed save and retries on the next change", async () => {
    const { saver, requests } = setup([
      () => ({ status: "failed", message: "Offline" }),
      savedAs(5),
    ]);
    saver.change({ content: doc("x") });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saver.current).toMatchObject({ status: "error", error: "Offline" });
    expect(saver.hasUnsavedChanges).toBe(true);
    saver.change({ content: doc("xy") });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(requests[1]).toMatchObject({ baseVersion: 4, content: doc("xy") });
    expect(saver.current.status).toBe("saved");
  });
});
