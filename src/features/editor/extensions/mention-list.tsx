"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

import { Avatar } from "@/features/issue/issue-badges";
import { type MentionUser } from "@/lib/notifications/views";
import { cn } from "@/lib/utils";

/**
 * The @mention suggestion popup (ISS-7, DOC-9): our own listbox, rendered by the suggestion
 * plugin next to the caret (`mention-suggestion.ts`). Focus stays in the editor, as in the
 * APG combobox pattern: the editor carries `aria-controls` and `aria-activedescendant` while
 * the list is open, and the plugin forwards the editor's keys to `onKeyDown`:
 *
 *   Down / Up    next / previous person (wrapping)    Home / End  first / last
 *   Enter / Tab  insert the active person             Esc         close (the plugin)
 */

export interface MentionListProps {
  items: MentionUser[];
  loading: boolean;
  /** Inserts the mention. */
  onSelect: (user: MentionUser) => void;
  /** Unique per popup, for `aria-controls` / `aria-activedescendant`. */
  listboxId: string;
  /** The editor's editable element, which keeps the focus. */
  editorDom: HTMLElement;
}

export interface MentionListHandle {
  /** Handles a key typed in the editor; true when the list used it. */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const optionId = (listboxId: string, index: number) => `${listboxId}-option-${index}`;

export const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList(
  { items, loading, onSelect, listboxId, editorDom },
  ref,
) {
  const [active, setActive] = useState(0);
  // A new result list starts at its first entry (adjusting state during render, not in an
  // effect, so the highlight never shows a stale index).
  const [seenItems, setSeenItems] = useState(items);
  if (seenItems !== items) {
    setSeenItems(items);
    setActive(0);
  }
  const current = items.length > 0 ? Math.min(active, items.length - 1) : -1;

  // The editor keeps the focus; point it at the list and the active option, and keep that
  // option in view (focus does not move, so the browser would not scroll to it).
  useEffect(() => {
    editorDom.setAttribute("aria-controls", listboxId);
    editorDom.setAttribute("aria-autocomplete", "list");
    editorDom.setAttribute("aria-haspopup", "listbox");
    if (current >= 0) {
      const id = optionId(listboxId, current);
      editorDom.setAttribute("aria-activedescendant", id);
      document.getElementById(id)?.scrollIntoView?.({ block: "nearest" });
    } else {
      editorDom.removeAttribute("aria-activedescendant");
    }
  }, [editorDom, listboxId, current]);
  useEffect(
    () => () => {
      for (const name of [
        "aria-controls",
        "aria-autocomplete",
        "aria-haspopup",
        "aria-activedescendant",
      ]) {
        editorDom.removeAttribute(name);
      }
    },
    [editorDom],
  );

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown(event) {
        if (event.altKey || event.ctrlKey || event.metaKey) return false;
        const count = items.length;
        if (count === 0) return false;
        switch (event.key) {
          case "ArrowDown":
            setActive((current + 1) % count);
            return true;
          case "ArrowUp":
            setActive((current - 1 + count) % count);
            return true;
          case "Home":
            setActive(0);
            return true;
          case "End":
            setActive(count - 1);
            return true;
          case "Enter":
          case "Tab": {
            const user = items[current];
            if (!user) return false;
            onSelect(user);
            return true;
          }
          default:
            return false;
        }
      },
    }),
    [items, current, onSelect],
  );

  // Announced only when there is nothing to pick: a count per keystroke would be noise
  // (the active option is announced through aria-activedescendant).
  const status = items.length > 0 ? null : loading ? "Loading people…" : "No matching people";

  return (
    <div className="w-72 max-w-[calc(100vw-2rem)] rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md">
      <ul
        role="listbox"
        id={listboxId}
        aria-label="Mention someone"
        className="max-h-64 overflow-y-auto"
      >
        {items.map((user, index) => (
          <li
            key={user.id}
            id={optionId(listboxId, index)}
            role="option"
            aria-selected={index === current}
            // Keep the editor focused and its selection where the mention goes.
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => onSelect(user)}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5",
              index === current && "bg-accent text-accent-foreground",
            )}
          >
            <Avatar name={user.name} className="size-6" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            </span>
          </li>
        ))}
      </ul>
      <p
        role="status"
        aria-live="polite"
        className={cn("px-2 py-1.5 text-xs text-muted-foreground", status === null && "sr-only")}
      >
        {status}
      </p>
    </div>
  );
});
