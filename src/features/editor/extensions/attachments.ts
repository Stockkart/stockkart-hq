import { Paperclip } from "lucide-react";

import {
  AttachmentImage,
  AttachmentPaste,
  AttachmentUpload,
  FileAttachment,
  pickFiles,
} from "../attachment-nodes";

import { type EditorFeature } from "./types";

/**
 * ISS-9 attachments in every editor variant: paste or drop images and files, or pick them
 * with the toolbar's "Attach file" button (the keyboard alternative to dragging). Where they
 * go is set by `AttachmentUploadProvider` around the editor.
 */
export const attachmentFeature: EditorFeature = {
  name: "attachments",
  variants: ["issue", "comment", "doc"],
  extensions: () => [AttachmentUpload, AttachmentImage, FileAttachment, AttachmentPaste],
  insertButtons: [
    {
      label: "Attach file",
      icon: Paperclip,
      isActive: () => false,
      run: (editor) => pickFiles(editor),
    },
  ],
};
