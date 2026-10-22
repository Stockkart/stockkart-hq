import { FILE_NODE, fileNodeAttrs, IMAGE_NODE, imageNodeAttrs } from "@/lib/attachments/nodes";
import { type RichTextNode } from "@/lib/rich-text";

import { type PlainTextRules } from "./types";

/**
 * ISS-9: an image contributes its alt text (its own line), a file chip its file name, so
 * both are searchable. The attachment id is never part of the text.
 */
export const attachmentPlainText: PlainTextRules = {
  [IMAGE_NODE]: {
    block: true,
    text: (node: RichTextNode) => imageNodeAttrs(node.attrs)?.alt ?? "",
  },
  [FILE_NODE]: {
    text: (node: RichTextNode) => fileNodeAttrs(node.attrs)?.filename ?? "",
  },
};
