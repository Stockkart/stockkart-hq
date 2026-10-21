import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTOSAVE_DELAY_MS,
  Autosaver,
  type SaveRequest,
  type SaveResponse,
} from "@/features/docs/autosaver";
import { type FlowScene } from "@/lib/diagrams/scene";

/** DGM-4: the diagram editor uses the docs' autosaver with a scene as its content. */

const scene = (label: string): FlowScene => ({
  nodes: [{ id: "a", type: "service", position: { x: 0, y: 0 }, data: { label } }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

function setup(responses: ((request: SaveRequest<FlowScene>) => SaveResponse<FlowScene>)[]) {
  const requests: SaveRequest<FlowScene>[] = [];
  const saver = new Autosaver<FlowScene>(
    { version: 2, content: scene("start"), title: "Flow" },
    {
      save: async (request) => {
        requests.push(request);
        const next = responses.shift();
        if (!next) throw new Error("unexpected save");
        return next(request);
      },
      onState: () => {},
    },
  );
  return { saver, requests };
}

describe("scene autosave (§7.4 optimistic lock)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("conflicts, then Keep mine re-bases my scene on the winner's version", async () => {
    const latest = { version: 5, title: "Flow", content: scene("theirs"), updatedByName: "RK" };
    const { saver, requests } = setup([
      () => ({ status: "conflict", latest }),
      () => ({ status: "saved", version: 6 }),
    ]);
    saver.change({ content: scene("mine") });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saver.current).toMatchObject({ status: "conflict", conflict: latest });

    saver.keepMine();
    await vi.advanceTimersByTimeAsync(0);
    expect(requests.map((r) => [r.baseVersion, r.content.nodes[0]?.data.label])).toEqual([
      [2, "mine"],
      [5, "mine"],
    ]);
    expect(saver.current).toMatchObject({ status: "saved", version: 6 });
  });

  it("Reload takes the winner's scene and continues from its version", async () => {
    const latest = { version: 9, title: "Theirs", content: scene("theirs"), updatedByName: null };
    const { saver } = setup([() => ({ status: "conflict", latest })]);
    saver.change({ content: scene("mine") });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saver.reload()).toEqual(latest);
    expect(saver.mine).toEqual({ title: "Theirs", content: scene("theirs") });
    expect(saver.current).toMatchObject({ status: "saved", version: 9 });
  });

  it("adopts a restored version only when nothing is pending", async () => {
    const { saver } = setup([() => ({ status: "saved", version: 3 })]);
    saver.change({ content: scene("unsaved") });
    expect(saver.adopt({ version: 7, content: scene("restored"), title: "Flow" })).toBe(false);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(saver.adopt({ version: 7, content: scene("restored"), title: "Flow" })).toBe(true);
    expect(saver.current).toMatchObject({ status: "saved", version: 7 });
    expect(saver.mine.content).toEqual(scene("restored"));
  });
});
