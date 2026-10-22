import { type RichTextNode } from "@/lib/rich-text";

import { type PlainTextRules } from "./types";

/** The name shown for a stored @mention (`attrs.label`, kept from when it was inserted). */
export function mentionLabel(node: RichTextNode): string | null {
  const label = node.attrs?.label;
  return typeof label === "string" && label.trim() !== "" ? label.trim() : null;
}

/** @user mentions (ISS-7, DOC-9) are inline: "@Name" in search text and plain text. */
export const mentionPlainText: PlainTextRules = {
  mention: { text: (node) => `@${mentionLabel(node) ?? "someone"}` },
};
