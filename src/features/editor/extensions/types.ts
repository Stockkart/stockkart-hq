import { type AnyExtension, type Editor } from "@tiptap/core";
import { type LucideIcon } from "lucide-react";

/**
 * Where an editor is used. Issues and comments share the basic toolbar; docs add the doc
 * blocks (DOC-1). Fixed for an editor's lifetime.
 */
export const EDITOR_VARIANTS = ["issue", "comment", "doc"] as const;
export type EditorVariant = (typeof EDITOR_VARIANTS)[number];

/** What a feature may read when it builds its Tiptap extensions. */
export interface EditorExtensionContext {
  variant: EditorVariant;
  /** Project keys whose `KEY-123` references are highlighted. */
  projectKeys: readonly string[];
}

export interface ToolbarContext {
  /** Opens the link form (doc variant). */
  openLink: () => void;
}

export interface ToolbarButton {
  /** Accessible name and tooltip; unique within one toolbar. */
  label: string;
  icon: LucideIcon;
  isActive: (editor: Editor) => boolean;
  /** Shown as aria-disabled and ignored, e.g. table actions outside a table. */
  isDisabled?: (editor: Editor) => boolean;
  run: (editor: Editor, context: ToolbarContext) => void;
}

/**
 * One editor node or behaviour (Mermaid, tables, @mentions, image paste, diagram embeds …),
 * self-contained in its own file under `extensions/` and listed once in
 * `extensions/index.ts`.
 */
export interface EditorFeature {
  name: string;
  /** The editors it is part of. */
  variants: readonly EditorVariant[];
  extensions: (context: EditorExtensionContext) => AnyExtension[];
  /** Buttons for the shared "insert" group, in registry order. */
  insertButtons?: ToolbarButton[];
  /** Whole toolbar groups of its own, after the insert group (e.g. table row/column actions). */
  toolbarGroups?: ToolbarButton[][];
}
