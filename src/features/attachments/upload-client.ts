import { type ActionResult } from "@/lib/action-result";
import { type AttachmentEntityType, MAX_ATTACHMENT_BYTES } from "@/lib/attachments/constants";
import { type AttachmentView, type StartedUpload } from "@/lib/attachments/views";
import {
  cancelUploadAction,
  confirmUploadAction,
  startUploadAction,
} from "@/server/actions/attachments";

import { prepareImage } from "./image-processing";

/**
 * The browser side of an ISS-9 upload: prepare (images are downscaled / re-encoded), ask the
 * server for a presigned PUT, PUT the bytes straight to R2 with exactly the signed headers
 * (XHR, for progress), then confirm. Never throws; failures come back as `{ ok: false }` with
 * a message fit for a toast.
 */

export interface UploadTarget {
  entityType: AttachmentEntityType;
  entityId: string;
}

export type UploadFile = (
  file: File,
  target: UploadTarget,
  options?: {
    onProgress?: (fraction: number) => void;
    /** A not-yet-posted comment's file: confirm without refreshing the page. */
    draft?: boolean;
  },
) => Promise<ActionResult<AttachmentView>>;

function put(
  upload: StartedUpload,
  body: File,
  onProgress?: (fraction: number) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    // Exactly the signed headers (Content-Type); the browser sets Content-Length.
    for (const [name, value] of Object.entries(upload.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => resolve(false);
    xhr.send(body);
  });
}

async function attempt<T>(action: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await action();
  } catch {
    return { ok: false, error: "Something went wrong. Reload the page and try again." };
  }
}

export const uploadFile: UploadFile = async (original, target, options = {}) => {
  const prepared = await prepareImage(original);
  const { file } = prepared;
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `${original.name} is larger than 10 MB` };
  }
  if (file.size === 0) return { ok: false, error: `${original.name} is empty` };
  const started = await attempt(() =>
    startUploadAction({
      ...target,
      filename: file.name || "file",
      mime: file.type,
      size: file.size,
      width: prepared.width,
      height: prepared.height,
    }),
  );
  if (!started.ok) return started;
  options.onProgress?.(0);
  const sent = await put(started.data, file, options.onProgress);
  if (!sent) {
    // Drop the pending row now rather than waiting for the purge.
    await attempt(() => cancelUploadAction({ attachmentId: started.data.attachmentId }));
    return { ok: false, error: `Uploading ${file.name} failed; check your connection and retry` };
  }
  return attempt(() =>
    confirmUploadAction({ attachmentId: started.data.attachmentId, draft: options.draft }),
  );
};
