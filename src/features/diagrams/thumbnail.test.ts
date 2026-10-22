import { describe, expect, it, vi } from "vitest";

import { THUMBNAIL_MAX_BYTES, THUMBNAIL_MIN_INTERVAL_MS } from "@/lib/diagrams/constants";

import { type ThumbnailDeps, ThumbnailUploader } from "./thumbnail";

const ID = "0c6f7a9e-5b1d-4c3a-9e2f-1a2b3c4d5e6f";

function setup(overrides: Partial<ThumbnailDeps> = {}) {
  let now = 1_000_000;
  const deps = {
    render: vi.fn(async () => new Blob(["png-bytes"], { type: "image/png" })),
    request: vi.fn<ThumbnailDeps["request"]>(async () => ({
      ok: true as const,
      data: {
        status: "upload" as const,
        url: "https://r2.example.test/signed",
        headers: { "Content-Type": "image/png" },
      },
    })),
    confirm: vi.fn(async () => ({ ok: true as const, data: { status: "saved" } })),
    put: vi.fn(async () => ({ ok: true })),
    now: () => now,
    ...overrides,
  };
  const uploader = new ThumbnailUploader(ID, deps);
  return { uploader, deps, advance: (ms: number) => (now += ms) };
}

describe("ThumbnailUploader (DGM-5)", () => {
  it("renders, presigns, PUTs and confirms the PNG", async () => {
    const { uploader, deps } = setup();
    uploader.markChanged();
    await uploader.maybeUpload();
    expect(deps.request).toHaveBeenCalledWith({ diagramId: ID, sizeBytes: 9 });
    expect(deps.put).toHaveBeenCalledWith("https://r2.example.test/signed", {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: expect.any(Blob),
    });
    expect(deps.confirm).toHaveBeenCalledWith({ diagramId: ID });
  });

  it("uploads at most once a minute after saves, but always when leaving after a change", async () => {
    const { uploader, deps, advance } = setup();
    uploader.markChanged();
    await uploader.maybeUpload();
    uploader.markChanged();
    advance(THUMBNAIL_MIN_INTERVAL_MS - 1);
    await uploader.maybeUpload();
    expect(deps.render).toHaveBeenCalledTimes(1);
    advance(1);
    await uploader.maybeUpload();
    expect(deps.render).toHaveBeenCalledTimes(2);

    uploader.markChanged();
    await uploader.maybeUpload({ force: true });
    expect(deps.render).toHaveBeenCalledTimes(3);
    // Nothing changed since: leaving again uploads nothing.
    await uploader.maybeUpload({ force: true });
    expect(deps.render).toHaveBeenCalledTimes(3);
  });

  it("stops quietly when storage is not configured", async () => {
    const { uploader, deps, advance } = setup({
      request: vi.fn<ThumbnailDeps["request"]>(async () => ({
        ok: true as const,
        data: { status: "skipped" as const },
      })),
    });
    uploader.markChanged();
    await uploader.maybeUpload();
    expect(uploader.disabled).toBe(true);
    expect(deps.put).not.toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
    uploader.markChanged();
    advance(THUMBNAIL_MIN_INTERVAL_MS * 2);
    await uploader.maybeUpload({ force: true });
    expect(deps.render).toHaveBeenCalledTimes(1);
  });

  it("never sends an oversized PNG, and retries later after a failure", async () => {
    const big = setup({
      render: vi.fn(async () => new Blob([new Uint8Array(THUMBNAIL_MAX_BYTES + 1)])),
    });
    big.uploader.markChanged();
    await big.uploader.maybeUpload();
    expect(big.deps.request).not.toHaveBeenCalled();

    const failing = setup({ put: vi.fn(async () => Promise.reject(new Error("offline"))) });
    failing.uploader.markChanged();
    await failing.uploader.maybeUpload();
    expect(failing.deps.confirm).not.toHaveBeenCalled();
    failing.advance(THUMBNAIL_MIN_INTERVAL_MS);
    await failing.uploader.maybeUpload();
    expect(failing.deps.put).toHaveBeenCalledTimes(2);
  });
});
