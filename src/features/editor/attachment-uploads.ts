import { type ActionResult } from "@/lib/action-result";
import { type AttachmentView } from "@/lib/attachments/views";

/**
 * Files waiting to be uploaded from an editor (ISS-9). A pasted or dropped file becomes an
 * `attachmentUpload` placeholder node holding only a random token; the File itself waits
 * here, outside the document, until the node view starts the upload. Each token uploads at
 * most once, however often its node view mounts (React strict mode, undo/redo).
 */

type Result = ActionResult<AttachmentView>;

interface UploadTask {
  file: File;
  progress: number;
  promise: Promise<Result> | null;
  listeners: Set<() => void>;
}

const tasks = new Map<string, UploadTask>();

function newToken(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Parks a file and returns the token its placeholder node carries. */
export function queueFile(file: File): string {
  const token = newToken();
  tasks.set(token, { file, progress: 0, promise: null, listeners: new Set() });
  return token;
}

/**
 * Starts the upload for `token` once and returns its promise (the same one on every call);
 * null when the token is unknown (a placeholder restored from a saved doc or another tab).
 */
export function runUpload(
  token: string,
  start: (file: File, onProgress: (fraction: number) => void) => Promise<Result>,
): Promise<Result> | null {
  const task = tasks.get(token);
  if (!task) return null;
  task.promise ??= start(task.file, (fraction) => {
    task.progress = Math.max(0, Math.min(1, fraction));
    task.listeners.forEach((listener) => listener());
  }).finally(() => {
    // The File is no longer needed; keep the settled promise for late subscribers briefly.
    setTimeout(() => tasks.delete(token), 60_000);
  });
  return task.promise;
}

export function uploadProgress(token: string): number {
  return tasks.get(token)?.progress ?? 0;
}

export function subscribeUpload(token: string, listener: () => void): () => void {
  const task = tasks.get(token);
  task?.listeners.add(listener);
  return () => task?.listeners.delete(listener);
}
