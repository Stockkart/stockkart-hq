/**
 * Runs `task` when the browser is idle (or after `timeoutMs` at the latest), for warming
 * caches that the next interaction will need: lazy chunks, dialog data. Returns a cancel
 * function for effect cleanup. Falls back to a timer where `requestIdleCallback` is missing.
 */
export function whenIdle(task: () => void, timeoutMs = 2000): () => void {
  if (typeof window === "undefined") return () => {};
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(task, { timeout: timeoutMs });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = setTimeout(task, 200);
  return () => clearTimeout(timer);
}

/**
 * A once-only loader: the first call starts `load`, later calls share its promise. A failed
 * load is forgotten, so the next call retries.
 */
export function preloader<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}
