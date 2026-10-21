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

  // The editor keeps the focus; point it at the list and the active option.
  useEffect(() => {
    editorDom.setAttribute("aria-controls", listboxId);
    if (current >= 0) editorDom.setAttribute("aria-activedescendant", optionId(listboxId, current));
    else editorDom.removeAttribute("aria-activedescendant");
  }, [editorDom, listboxId, current]);
  useEffect(
    () => () => {
      editorDom.removeAttribute("aria-controls");
      editorDom.removeAttribute("aria-activedescendant");
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

  const status = loading
    ? "Loading people…"
    : items.length === 0
      ? "No matching people"
      : `${items.length} ${items.length === 1 ? "person" : "people"}`;

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
        className={cn("px-2 py-1.5 text-xs text-muted-foreground", items.length > 0 && "sr-only")}
      >
        {status}
      </p>
    </div>
  );
});
