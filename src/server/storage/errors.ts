/** What callers show when R2 is not set up (the route answers 503 with it). */
export const STORAGE_NOT_CONFIGURED_MESSAGE = "File storage isn't set up yet";

/**
 * Thrown by every storage function while the R2 env vars are incomplete (fail closed: no
 * fallback store, no public URLs). Catch it to show `STORAGE_NOT_CONFIGURED_MESSAGE`.
 */
export class StorageNotConfigured extends Error {
  constructor() {
    super(STORAGE_NOT_CONFIGURED_MESSAGE);
    this.name = "StorageNotConfigured";
  }
}

/** A key, size or type the storage module refuses before signing anything. */
export class StorageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageInputError";
  }
}
