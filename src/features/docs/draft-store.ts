import { z } from "zod";

import { richTextDocSchema, type RichTextDoc } from "@/lib/rich-text";

/**
 * Unsaved doc edits kept in this tab's sessionStorage when the person leaves a doc whose
 * changes could not be saved (a conflict or a failed save), so client-side navigation never
 * silently drops them (§7.4). sessionStorage lives only as long as the tab and is never sent
 * anywhere; the content is validated with the editor schema when it is read back.
 */

export interface DocDraft {
  title: string;
  content: RichTextDoc;
  savedAt: string;
}

const draftSchema = z.object({
  title: z.string().max(1000),
  content: richTextDocSchema,
  savedAt: z.string(),
});

const keyFor = (docId: string) => `hq.doc-draft.${docId}`;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Storage can be disabled (privacy settings); drafts are then simply not kept.
    return null;
  }
}

export function saveDraft(docId: string, draft: Omit<DocDraft, "savedAt">) {
  try {
    storage()?.setItem(
      keyFor(docId),
      JSON.stringify({ ...draft, savedAt: new Date().toISOString() }),
    );
  } catch {
    // Quota exceeded: nothing more we can do without a server round trip.
  }
}

export function readDraft(docId: string): DocDraft | null {
  const raw = storage()?.getItem(keyFor(docId));
  if (!raw) return null;
  try {
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function clearDraft(docId: string) {
  storage()?.removeItem(keyFor(docId));
}
