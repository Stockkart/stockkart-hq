"use client";

import { Download } from "lucide-react";
import { useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { attachmentUrl } from "@/lib/attachments/nodes";

/**
 * An attached image in read-only rich text (ISS-9). Always loaded through the authed
 * `/api/files/<id>` route (S-5), lazily, with its width and height so the box is reserved
 * before it arrives (no layout shift). Activating it opens the full-size image in our own
 * dialog (focus trapped, Escape closes, focus returns).
 */
export function AttachmentImage({
  attachmentId,
  alt,
  width,
  height,
}: {
  attachmentId: string;
  alt: string;
  width: number | null;
  height: number | null;
}) {
  const [open, setOpen] = useState(false);
  const src = attachmentUrl(attachmentId);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="my-2 block max-w-full cursor-zoom-in rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label={alt ? `View full size: ${alt}` : "View image full size"}
      >
        {/* The authed route redirects to a short-lived signed URL; next/image cannot proxy that. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          width={width ?? undefined}
          height={height ?? undefined}
          loading="lazy"
          decoding="async"
          className="h-auto max-w-full rounded-md border"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="top-1/2 flex max-h-[95dvh] w-auto -translate-y-1/2 flex-col items-center gap-3 p-4 sm:max-w-[95vw]"
        >
          <DialogTitle className="pr-8 text-sm font-medium">{alt || "Image"}</DialogTitle>
          {open ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={alt}
              width={width ?? undefined}
              height={height ?? undefined}
              className="h-auto max-h-[80dvh] w-auto max-w-full object-contain"
            />
          ) : null}
          <a
            href={attachmentUrl(attachmentId, { download: true })}
            className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline"
          >
            <Download aria-hidden="true" className="size-4" />
            Download
          </a>
        </DialogContent>
      </Dialog>
    </>
  );
}
