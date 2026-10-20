"use client";

import dynamic from "next/dynamic";

/**
 * The editor bundle (Tiptap + ProseMirror) loads only in the browser and only where an editor
 * is shown (SPEC §9.2). The placeholder keeps the layout from jumping while it loads.
 */
export const LazyRichTextEditor = dynamic(
  () => import("./rich-text-editor").then((module) => module.RichTextEditor),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden="true"
        className="h-[calc(6rem+2.25rem+2px)] animate-pulse rounded-md border bg-muted/40"
      />
    ),
  },
);
