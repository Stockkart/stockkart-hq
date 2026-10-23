import { type ComponentType } from "react";

import { type AdrRef, type DocDetail, type DocRef } from "@/lib/docs/views";
import { type RichTextDoc } from "@/lib/rich-text";

/**
 * The doc header's "⋯" menu (docs UX): a registry of action descriptors, so another slice
 * (handbook sync: "Publish to handbook", "Pull from handbook") adds ONE line to
 * `DOC_ACTIONS` in `index.ts` and a file of its own. Client-side only.
 */

/** What an action may use. Built by the doc page for the doc on screen. */
export interface DocActionContext {
  doc: DocDetail;
  ancestors: DocRef[];
  /** ADRs this one supersedes (ADR-3). */
  supersedes: AdrRef[];
  childCount: number;
  editing: boolean;
  /** The latest title and content (the editor's copy while editing). */
  current: () => { title: string; content: RichTextDoc | null };
  /** Saves pending edits first (edit mode); false if they could not all be saved. */
  flush: () => Promise<boolean>;
  navigate: (href: string) => void;
  /** Starts a file download from an HQ route (the browser keeps the page). */
  download: (href: string) => void;
  copyText: (text: string) => Promise<void>;
}

export interface DocActionDialogProps {
  context: DocActionContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export interface DocAction {
  /** Unique across the registry (checked at load). */
  id: string;
  label: string | ((context: DocActionContext) => string);
  /** Hidden when false (e.g. ADR-only actions). */
  visible?: (context: DocActionContext) => boolean;
  destructive?: boolean;
  /** Either runs at once … */
  run?: (context: DocActionContext) => void | Promise<void>;
  /** … or opens this dialog (rendered by the menu while open). */
  dialog?: ComponentType<DocActionDialogProps>;
}

/**
 * The header's status slot: badges shown next to the breadcrumb (e.g. the handbook sync
 * state). A badge renders nothing when it has nothing to say.
 */
export interface DocHeaderBadge {
  id: string;
  Badge: ComponentType<{ doc: DocDetail }>;
}
