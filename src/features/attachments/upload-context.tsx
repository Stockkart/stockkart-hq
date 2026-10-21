"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

import { type UploadFile, uploadFile, type UploadTarget } from "./upload-client";

/**
 * Where files dropped or pasted into an editor go (ISS-9). Pages wrap an editor in
 * `AttachmentUploadProvider` with the issue, doc or comment it belongs to; the editor's
 * attachment nodes read it (Tiptap renders node views inside the editor's React tree), so
 * the shared editor needs no upload props. Without a provider (e.g. a new issue that does
 * not exist yet) uploads are refused with a hint instead.
 */

export interface AttachmentUploadContextValue {
  target: UploadTarget | null;
  /** False while R2 is not configured: uploads are refused with a message, nothing breaks. */
  storageReady: boolean;
  upload: UploadFile;
}

const AttachmentUploadContext = createContext<AttachmentUploadContextValue>({
  target: null,
  storageReady: false,
  upload: uploadFile,
});

export function AttachmentUploadProvider({
  target,
  storageReady,
  upload = uploadFile,
  children,
}: {
  target: UploadTarget | null;
  storageReady: boolean;
  /** Injectable for tests. */
  upload?: UploadFile;
  children: ReactNode;
}) {
  const entityType = target?.entityType;
  const entityId = target?.entityId;
  const value = useMemo<AttachmentUploadContextValue>(
    () => ({
      target: entityType && entityId ? { entityType, entityId } : null,
      storageReady,
      upload,
    }),
    [entityType, entityId, storageReady, upload],
  );
  return (
    <AttachmentUploadContext.Provider value={value}>{children}</AttachmentUploadContext.Provider>
  );
}

export function useAttachmentUpload(): AttachmentUploadContextValue {
  return useContext(AttachmentUploadContext);
}
