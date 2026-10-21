import { env } from "@/env";

import { createStorage, storageConfigFrom } from "./storage";

/**
 * The app's R2 storage, wired from env once (server-only: imports `@/env`). See
 * `storage.ts` for the API and README "File storage (R2)" for the bucket setup.
 */
export const storage = createStorage(storageConfigFrom(env));

export const storageConfigured = () => storage.storageConfigured();
export const presignUpload: typeof storage.presignUpload = (input) => storage.presignUpload(input);
export const presignDownload: typeof storage.presignDownload = (input) =>
  storage.presignDownload(input);
export const headObject: typeof storage.headObject = (key) => storage.headObject(key);
export const deleteObject: typeof storage.deleteObject = (key) => storage.deleteObject(key);
export const putObject: typeof storage.putObject = (input) => storage.putObject(input);

export {
  classifyUpload,
  effectiveDisposition,
  isAllowedUploadSize,
  type Disposition,
  type UploadClass,
} from "@/lib/attachments/policy";
export { STORAGE_NOT_CONFIGURED_MESSAGE, StorageInputError, StorageNotConfigured } from "./errors";
export { attachmentKey, diagramThumbnailKey, KEY_PREFIXES, sanitizeFilename } from "./keys";
export { PRESIGN_TTL_SECONDS, type Storage } from "./storage";
