import { MarkdownPaste } from "../markdown-paste";

import { type EditorFeature } from "./types";

/** Pasting Markdown text formats it, in every editor (see `markdown-paste.ts`). */
export const markdownPasteFeature: EditorFeature = {
  name: "markdownPaste",
  variants: ["issue", "comment", "doc"],
  extensions: () => [MarkdownPaste],
};
