import { type RichTextDoc } from "@/lib/rich-text";

/**
 * Client side of §7.4 autosave with optimistic locking, as a small state machine with no
 * React in it (so it is easy to test). The editor reports every change; ~2 s after the last
 * one the saver sends the content with the version it was based on. The server answers
 * "saved at version n" or "conflict" with the winner's copy.
 *
 * On a conflict autosave stops until the person chooses:
 * - reload: take the winner's copy and continue from its version;
 * - keep mine: save my copy again, based on the winner's version. That is still a locked
 *   save, so if a third save landed meanwhile it conflicts again (never a blind overwrite);
 * - copy mine (done by the UI): copy my text, then usually reload.
 */

export const AUTOSAVE_DELAY_MS = 2000;

export interface ConflictInfo {
  version: number;
  title: string;
  content: RichTextDoc | null;
  updatedByName: string | null;
}

export type SaveResponse =
  | { status: "saved"; version: number; snapshotted?: boolean }
  | { status: "conflict"; latest: ConflictInfo }
  /** The request failed (network, validation, session); `message` is for the person. */
  | { status: "failed"; message: string };

export interface SaveRequest {
  baseVersion: number;
  content: RichTextDoc;
  /** Sent only when the title changed since the last successful save. */
  title?: string;
  snapshot: boolean;
}

export type SaverStatus = "saved" | "dirty" | "saving" | "conflict" | "error";

export interface SaverState {
  status: SaverStatus;
  version: number;
  conflict: ConflictInfo | null;
  error: string | null;
}

export interface AutosaverDeps {
  save: (request: SaveRequest) => Promise<SaveResponse>;
  onState: (state: SaverState) => void;
  /** After a successful save (e.g. refresh the page if the title changed). */
  onSaved?: (saved: {
    version: number;
    titleChanged: boolean;
    snapshotted: boolean;
    content: RichTextDoc;
  }) => void;
  delayMs?: number;
}

export class DocAutosaver {
  private state: SaverState;
  private content: RichTextDoc;
  private title: string;
  /** The title as of the last successful save (or load). */
  private savedTitle: string;
  /** Bumped on every change, so a save can tell whether newer edits arrived meanwhile. */
  private revision = 0;
  private savedRevision = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private snapshotRequested = false;
  /** "Keep mine": the title must be re-sent even if it equals the last saved one. */
  private forceTitle = false;

  constructor(
    initial: { version: number; content: RichTextDoc; title: string },
    private readonly deps: AutosaverDeps,
  ) {
    this.state = { status: "saved", version: initial.version, conflict: null, error: null };
    this.content = initial.content;
    this.title = initial.title;
    this.savedTitle = initial.title;
  }

  get current(): SaverState {
    return this.state;
  }

  /** My current copy (for "Copy mine"). */
  get mine(): { title: string; content: RichTextDoc } {
    return { title: this.title, content: this.content };
  }

  get hasUnsavedChanges(): boolean {
    return this.revision !== this.savedRevision || this.state.status === "conflict";
  }

  change(update: { content?: RichTextDoc; title?: string }) {
    if (update.content) this.content = update.content;
    if (update.title !== undefined) this.title = update.title;
    this.revision += 1;
    if (this.state.status === "conflict") return; // wait for the person's choice
    this.setState({ status: this.inFlight ? "saving" : "dirty", error: null });
    this.schedule();
  }

  /** "Save version": save now and keep a snapshot. Also flushes pending changes. */
  saveNow(snapshot = false) {
    if (snapshot) this.snapshotRequested = true;
    if (this.state.status === "conflict") return;
    this.clearTimer();
    void this.run();
  }

  /** Take the winner's copy. Returns it so the UI can reset the editor. */
  reload(): ConflictInfo | null {
    const latest = this.state.conflict;
    if (!latest) return null;
    this.clearTimer();
    this.content = latest.content ?? this.content;
    this.title = latest.title;
    this.savedTitle = latest.title;
    this.savedRevision = this.revision;
    this.forceTitle = false;
    this.setState({ status: "saved", version: latest.version, conflict: null, error: null });
    return latest;
  }

  /** Overwrite with my copy, re-based on the winner's version (still a locked save). */
  keepMine() {
    const latest = this.state.conflict;
    if (!latest) return;
    this.forceTitle = true;
    this.setState({ status: "dirty", version: latest.version, conflict: null });
    this.saveNow();
  }

  dispose() {
    this.clearTimer();
  }

  private setState(patch: Partial<SaverState>) {
    this.state = { ...this.state, ...patch };
    this.deps.onState(this.state);
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.deps.delayMs ?? AUTOSAVE_DELAY_MS);
  }

  private async run() {
    // One save at a time; changes made meanwhile are saved right after (see below).
    if (this.inFlight || this.state.status === "conflict") return;
    const nothingNew = this.revision === this.savedRevision && !this.snapshotRequested;
    if (nothingNew && !this.forceTitle) return;
    const sentRevision = this.revision;
    const sentContent = this.content;
    const sentTitle = this.title;
    const titleChanged = this.forceTitle || sentTitle !== this.savedTitle;
    const snapshot = this.snapshotRequested;
    this.inFlight = true;
    this.setState({ status: "saving", error: null });
    let response: SaveResponse;
    try {
      response = await this.deps.save({
        baseVersion: this.state.version,
        content: sentContent,
        title: titleChanged ? sentTitle : undefined,
        snapshot,
      });
    } catch {
      response = { status: "failed", message: "Could not save. Check your connection." };
    }
    this.inFlight = false;

    if (response.status === "saved") {
      this.savedRevision = sentRevision;
      this.savedTitle = sentTitle;
      this.forceTitle = false;
      if (snapshot) this.snapshotRequested = false;
      const pending = this.revision !== sentRevision;
      this.setState({ status: pending ? "dirty" : "saved", version: response.version });
      this.deps.onSaved?.({
        version: response.version,
        titleChanged,
        snapshotted: response.snapshotted ?? false,
        content: sentContent,
      });
      if (pending) this.schedule();
    } else if (response.status === "conflict") {
      this.setState({ status: "conflict", conflict: response.latest });
    } else {
      this.setState({ status: "error", error: response.message });
    }
  }
}
