import { canonicalJson } from "@/lib/canonical-json";
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

export interface ConflictInfo<C = RichTextDoc> {
  version: number;
  title: string;
  content: C | null;
  updatedByName: string | null;
}

export type SaveResponse<C = RichTextDoc> =
  | { status: "saved"; version: number; snapshotted?: boolean }
  | { status: "conflict"; latest: ConflictInfo<C> }
  /** The request failed (network, validation, session); `message` is for the person. */
  | { status: "failed"; message: string };

export interface SaveRequest<C = RichTextDoc> {
  baseVersion: number;
  content: C;
  /** Sent only when the title changed since the last successful save. */
  title?: string;
  snapshot: boolean;
}

export type SaverStatus = "saved" | "dirty" | "saving" | "conflict" | "error";

export interface SaverState<C = RichTextDoc> {
  status: SaverStatus;
  version: number;
  conflict: ConflictInfo<C> | null;
  error: string | null;
}

export interface AutosaverDeps<C = RichTextDoc> {
  save: (request: SaveRequest<C>) => Promise<SaveResponse<C>>;
  onState: (state: SaverState<C>) => void;
  /** After a successful save (e.g. refresh the page if the title changed). */
  onSaved?: (saved: {
    version: number;
    titleChanged: boolean;
    snapshotted: boolean;
    content: C;
  }) => void;
  delayMs?: number;
}

/**
 * The state machine for any optimistically locked content: `C` is the editor's content
 * (rich text for docs, a scene for diagrams, DGM-4).
 */
export class Autosaver<C> {
  private state: SaverState<C>;
  private content: C;
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
  /** The latest save's promise (resolved when it has been fully handled), for `flush`. */
  private settled: Promise<void> = Promise.resolve();

  constructor(
    initial: { version: number; content: C; title: string },
    private readonly deps: AutosaverDeps<C>,
  ) {
    this.state = { status: "saved", version: initial.version, conflict: null, error: null };
    this.content = initial.content;
    this.title = initial.title;
    this.savedTitle = initial.title;
  }

  get current(): SaverState<C> {
    return this.state;
  }

  /** My current copy (for "Copy mine"). */
  get mine(): { title: string; content: C } {
    return { title: this.title, content: this.content };
  }

  get hasUnsavedChanges(): boolean {
    return this.revision !== this.savedRevision || this.state.status === "conflict";
  }

  change(update: { content?: C; title?: string }) {
    if (update.content !== undefined) this.content = update.content;
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
  reload(): ConflictInfo<C> | null {
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

  /**
   * Adopt a newer server version that holds exactly my content (e.g. the doc was renamed
   * from the tree, which bumps the version). Only then is it safe to continue from it: if
   * the content differs, someone else saved and the next save must conflict. Returns the
   * server title when it was adopted (unless I have an unsaved title of my own), else null.
   */
  rebase(server: { version: number; title: string; content: C | null }): string | null {
    if (this.inFlight || this.state.status === "conflict") return null;
    if (server.version <= this.state.version) return null;
    if (canonicalJson(server.content) !== canonicalJson(this.content)) return null;
    const titleIsMine = this.title !== this.savedTitle;
    this.savedTitle = server.title;
    if (!titleIsMine) this.title = server.title;
    this.setState({ version: server.version });
    return titleIsMine ? null : server.title;
  }

  dispose() {
    this.clearTimer();
  }

  /**
   * Saves everything pending now and resolves once nothing is in flight (the doc page's
   * "Done"): waits for a save already running, then saves what is left. Returns the final
   * state; `conflict` or `error` means my changes are not all saved (the caller warns).
   */
  async flush(): Promise<SaverState<C>> {
    this.clearTimer();
    for (let round = 0; round < 5; round += 1) {
      await this.settled;
      this.clearTimer();
      if (this.state.status === "conflict") break;
      const pending =
        this.revision !== this.savedRevision || this.snapshotRequested || this.forceTitle;
      if (!pending) break;
      await this.run();
      if (this.state.status === "error") break;
    }
    return this.state;
  }

  /**
   * Continue from a version the server just wrote on my behalf (e.g. a DGM-4 restore):
   * its content and title become mine, with nothing pending. Only while nothing is in
   * flight or unsaved, so no edit is dropped.
   */
  adopt(next: { version: number; content: C; title: string }): boolean {
    if (this.inFlight || this.hasUnsavedChanges) return false;
    this.clearTimer();
    this.content = next.content;
    this.title = next.title;
    this.savedTitle = next.title;
    this.setState({ status: "saved", version: next.version, conflict: null, error: null });
    return true;
  }

  private setState(patch: Partial<SaverState<C>>) {
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

  /** Starts a save (unless one is running); resolves when the latest save has finished. */
  private run(): Promise<void> {
    if (this.inFlight || this.state.status === "conflict") return this.settled;
    const work = this.runSave();
    this.settled = work;
    return work;
  }

  private async runSave() {
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
    let response: SaveResponse<C>;
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
      const pending = this.revision !== sentRevision || this.snapshotRequested || this.forceTitle;
      this.setState({ status: pending ? "dirty" : "saved", version: response.version });
      this.deps.onSaved?.({
        version: response.version,
        titleChanged,
        snapshotted: response.snapshotted ?? false,
        content: sentContent,
      });
      if (pending) {
        // A "Save version" clicked during this save runs right away; edits wait as usual.
        if (this.snapshotRequested) void this.run();
        else this.schedule();
      }
    } else if (response.status === "conflict") {
      this.setState({ status: "conflict", conflict: response.latest });
    } else {
      this.setState({ status: "error", error: response.message });
    }
  }
}

/** §7.4 doc autosave (rich text content). */
export class DocAutosaver extends Autosaver<RichTextDoc> {}
