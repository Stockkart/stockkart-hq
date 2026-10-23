/**
 * SPEC §9.5 keyboard shortcuts, in ONE registry: the handlers match keys with
 * `matchesShortcut`, and the `?` help dialog lists this table, so the two cannot drift.
 * Isomorphic and dependency-free.
 */

export type ShortcutId =
  | "create"
  | "search"
  | "next"
  | "previous"
  | "open"
  | "select"
  | "help"
  | "submit"
  | "close"
  | "mention"
  | "editNode"
  | "commentOnSelection"
  | "docPages"
  | "docEdit"
  | "docDone";

export interface Shortcut {
  id: ShortcutId;
  /** Keys as shown, pressed together (e.g. `["⌘/Ctrl", "K"]`). */
  keys: string[];
  description: string;
  /** Where it works. */
  scope: (typeof SHORTCUT_SCOPES)[number];
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: "create", keys: ["C"], description: "Create an issue", scope: "Anywhere" },
  { id: "search", keys: ["⌘/Ctrl", "K"], description: "Search and commands", scope: "Anywhere" },
  { id: "help", keys: ["?"], description: "Show keyboard shortcuts", scope: "Anywhere" },
  { id: "next", keys: ["J"], description: "Next row", scope: "Lists" },
  { id: "previous", keys: ["K"], description: "Previous row", scope: "Lists" },
  { id: "open", keys: ["Enter"], description: "Open the selected row", scope: "Lists" },
  {
    id: "select",
    keys: ["X"],
    description: "Select the focused row for bulk edit",
    scope: "Lists",
  },
  {
    id: "submit",
    keys: ["⌘/Ctrl", "Enter"],
    description: "Create (in the create dialog)",
    scope: "Dialogs",
  },
  { id: "close", keys: ["Esc"], description: "Close a dialog or menu", scope: "Dialogs" },
  // ISS-7/DOC-9: the trigger of Tiptap's mention suggestion (its default `char`).
  { id: "mention", keys: ["@"], description: "Mention someone", scope: "Editors" },
  // DOC-13: the doc editor's comment mark (`Mod-Alt-m` in comment-anchor-mark.ts).
  {
    id: "commentOnSelection",
    keys: ["⌘/Ctrl", "Alt", "M"],
    description: "Comment on the selected text (docs)",
    scope: "Editors",
  },
  // DOC-2 / docs UX: the doc page (features/docs/doc-screen.tsx matches these).
  { id: "docPages", keys: ["["], description: "Open the page tree", scope: "Docs" },
  { id: "docEdit", keys: ["E"], description: "Edit the doc", scope: "Docs" },
  {
    id: "docDone",
    keys: ["⌘/Ctrl", "Enter"],
    description: "Done editing: save and back to reading (or Esc)",
    scope: "Docs",
  },
  // DGM-*: the flow editor's canvas (flow-canvas.tsx matches it).
  { id: "editNode", keys: ["Enter"], description: "Rename the focused node", scope: "Diagrams" },
];

/** The `KeyboardEvent.key` each single-key shortcut answers to (lower-cased). */
const KEYS: Partial<Record<ShortcutId, string>> = {
  create: "c",
  search: "k",
  next: "j",
  previous: "k",
  select: "x",
  help: "?",
  mention: "@",
  editNode: "enter",
  docPages: "[",
  docEdit: "e",
  docDone: "enter",
};

/**
 * Whether `event` is the shortcut's key. Only the key: callers still apply their guard
 * (`shouldIgnoreShortcut` for single keys, the modifier check for ⌘K).
 */
export function matchesShortcut(event: Pick<KeyboardEvent, "key">, id: ShortcutId): boolean {
  const key = KEYS[id];
  return key !== undefined && event.key.toLowerCase() === key;
}

export const SHORTCUT_SCOPES = [
  "Anywhere",
  "Lists",
  "Dialogs",
  "Editors",
  "Docs",
  "Diagrams",
] as const;

/** The `?` dialog's heading per scope. */
export const SHORTCUT_SCOPE_LABELS: Record<(typeof SHORTCUT_SCOPES)[number], string> = {
  Anywhere: "Anywhere",
  Lists: "In lists (issues, backlog)",
  Dialogs: "Dialogs",
  Editors: "In editors (descriptions, comments, docs)",
  Docs: "On a doc page",
  Diagrams: "In flow diagrams",
};
