import { type ActionResult } from "@/lib/action-result";
import { THUMBNAIL_MAX_BYTES, THUMBNAIL_MIN_INTERVAL_MS } from "@/lib/diagrams/constants";

/**
 * DGM-5 client side: after a save (at most once a minute per diagram) and when leaving the
 * page, render a PNG (≤ 640 px wide) and upload it: ask the server for a presigned PUT of
 * `thumbnails/diagrams/<id>.png`, PUT the bytes to R2, then confirm. When storage is not
 * configured the server answers "skipped" and the uploader stops trying for this page
 * (the cards keep their kind icon). Failures are silent: a thumbnail is a nicety.
 */

export interface ThumbnailDeps {
  render: () => Promise<Blob>;
  request: (input: {
    diagramId: string;
    sizeBytes: number;
  }) => Promise<
    ActionResult<
      { status: "skipped" } | { status: "upload"; url: string; headers: Record<string, string> }
    >
  >;
  confirm: (input: { diagramId: string }) => Promise<ActionResult<unknown>>;
  put: (
    url: string,
    init: { method: "PUT"; headers: Record<string, string>; body: Blob },
  ) => Promise<{
    ok: boolean;
  }>;
  now?: () => number;
}

export class ThumbnailUploader {
  private lastAt: number | null = null;
  private skipped = false;
  private inFlight: Promise<void> | null = null;
  /** A change since the last upload, so leaving the page knows whether one is due. */
  private stale = false;

  constructor(
    private readonly diagramId: string,
    private readonly deps: ThumbnailDeps,
  ) {}

  /** Storage is not configured: nothing more will be tried. */
  get disabled(): boolean {
    return this.skipped;
  }

  markChanged() {
    this.stale = true;
  }

  /**
   * After a save: upload unless one went out less than a minute ago. `force` (leaving the
   * page) ignores the minute but still needs a change since the last upload.
   */
  maybeUpload({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (this.skipped || this.inFlight || !this.stale) return this.inFlight ?? Promise.resolve();
    const now = (this.deps.now ?? Date.now)();
    if (!force && this.lastAt !== null && now - this.lastAt < THUMBNAIL_MIN_INTERVAL_MS) {
      return Promise.resolve();
    }
    this.lastAt = now;
    this.stale = false;
    this.inFlight = this.upload().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async upload(): Promise<void> {
    try {
      const blob = await this.deps.render();
      if (blob.size === 0 || blob.size > THUMBNAIL_MAX_BYTES) return;
      const ticket = await this.deps.request({ diagramId: this.diagramId, sizeBytes: blob.size });
      if (!ticket.ok) return;
      if (ticket.data.status === "skipped") {
        this.skipped = true;
        return;
      }
      const response = await this.deps.put(ticket.data.url, {
        method: "PUT",
        headers: ticket.data.headers,
        body: blob,
      });
      if (!response.ok) return;
      await this.deps.confirm({ diagramId: this.diagramId });
    } catch {
      // A thumbnail is optional; the next save tries again.
      this.stale = true;
    }
  }
}
