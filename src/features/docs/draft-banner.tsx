"use client";

import { Undo2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { canonicalJson } from "@/lib/canonical-json";
import { type RichTextDoc } from "@/lib/rich-text";

import { clearDraft, type DocDraft, readDraft } from "./draft-store";

interface DraftBannerProps {
  docId: string;
  /** The doc as loaded; a draft equal to it is stale and dropped. */
  current: { title: string; content: RichTextDoc | null };
  onRestore: (draft: DocDraft) => void;
}

const ABSOLUTE = new Intl.DateTimeFormat("en", { timeStyle: "short" });

/** Offers edits that could not be saved last time (see draft-store.ts). Client-only. */
function DraftBanner({ docId, current, onRestore }: DraftBannerProps) {
  const [draft, setDraft] = useState<DocDraft | null>(() => {
    const stored = readDraft(docId);
    const stale =
      stored &&
      stored.title === current.title &&
      canonicalJson(stored.content) === canonicalJson(current.content);
    if (stale) clearDraft(docId);
    return stale ? null : stored;
  });
  if (!draft) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-md border border-sky-500/50 bg-sky-500/10 px-3 py-2 text-sm"
    >
      <span className="flex-1">
        You left this page at {ABSOLUTE.format(new Date(draft.savedAt))} with changes that were not
        saved.
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          clearDraft(docId);
          setDraft(null);
          onRestore(draft);
        }}
      >
        <Undo2 aria-hidden="true" />
        Restore my changes
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          clearDraft(docId);
          setDraft(null);
        }}
      >
        Discard
      </Button>
    </div>
  );
}

/** sessionStorage exists only in the browser, so the banner never renders on the server. */
export const LazyDraftBanner = dynamic(() => Promise.resolve(DraftBanner), { ssr: false });
