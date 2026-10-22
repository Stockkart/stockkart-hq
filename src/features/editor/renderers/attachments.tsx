import { Paperclip } from "lucide-react";

import { AttachmentImage } from "@/features/attachments/attachment-image";
import {
  attachmentUrl,
  FILE_NODE,
  fileNodeAttrs,
  IMAGE_NODE,
  imageNodeAttrs,
} from "@/lib/attachments/nodes";
import { formatBytes } from "@/lib/attachments/views";

import { type NodeRenderers } from "./types";

/**
 * ISS-9 images and file chips in the read-only view. Every URL is the authed
 * `/api/files/<id>` route, built from a validated uuid: no storage key or presigned URL ever
 * reaches the HTML (S-5). A node without a valid id renders nothing.
 */
export const attachmentRenderers: NodeRenderers = {
  [IMAGE_NODE]: ({ node, index }) => {
    const attrs = imageNodeAttrs(node.attrs);
    if (!attrs) return null;
    return (
      <AttachmentImage
        key={index}
        attachmentId={attrs.attachmentId}
        alt={attrs.alt}
        width={attrs.width}
        height={attrs.height}
      />
    );
  },
  [FILE_NODE]: ({ node, index }) => {
    const attrs = fileNodeAttrs(node.attrs);
    if (!attrs) return null;
    return (
      <a
        key={index}
        href={attachmentUrl(attrs.attachmentId, { download: true })}
        data-type={FILE_NODE}
        className="inline-flex items-center gap-1 rounded border bg-muted px-1.5 py-0.5 align-baseline text-xs no-underline hover:bg-accent"
      >
        <Paperclip aria-hidden="true" className="size-3" />
        {attrs.filename}
        {attrs.size !== null ? (
          <span className="text-muted-foreground">({formatBytes(attrs.size)})</span>
        ) : null}
      </a>
    );
  },
};
