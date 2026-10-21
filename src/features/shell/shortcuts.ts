/**
 * SPEC §9.5 keyboard shortcuts, in ONE registry: the handlers match keys with
 * `matchesShortcut`, and the `?` help dialog lists this table, so the two cannot drift.
 * Isomorphic and dependency-free.
 */

export type ShortcutId =
  "create" | "search" | "next" | "previous" | "open" | "select" | "help" | "submit" | "close";

export interface Shortcut {
  id: ShortcutId;
  /** Keys as shown, pressed together (e.g. `["⌘/Ctrl", "K"]`). */
  keys: string[];
  description: string;
  /** Where it works. */
  scope: "Anywhere" | "Lists" | "Dialogs";
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
];

/** The `KeyboardEvent.key` each single-key shortcut answers to (lower-cased). */
const KEYS: Partial<Record<ShortcutId, string>> = {
  create: "c",
  search: "k",
  next: "j",
  previous: "k",
  select: "x",
  help: "?",
};

/**
 * Whether `event` is the shortcut's key. Only the key: callers still apply their guard
 * (`shouldIgnoreShortcut` for single keys, the modifier check for ⌘K).
 */
export function matchesShortcut(event: Pick<KeyboardEvent, "key">, id: ShortcutId): boolean {
  const key = KEYS[id];
  return key !== undefined && event.key.toLowerCase() === key;
}

export const SHORTCUT_SCOPES = ["Anywhere", "Lists", "Dialogs"] as const;
