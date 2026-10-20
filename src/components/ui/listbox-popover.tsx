"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, Search } from "lucide-react";
import * as React from "react";
import { flushSync } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * The shared engine of `Select`, `MultiSelect` and `Combobox` (our own pickers; there is no
 * native select element in the app). Radix Popover only positions the popup (portal, collision
 * aware, works inside dialogs) and handles outside clicks and Esc; the combobox and listbox
 * behaviour follows the WAI-ARIA APG:
 *
 * - The trigger is a `combobox` button labelled by the field label. Enter, Space, Alt+Down,
 *   Down and Up open it; typing a character opens it on the first match (type-ahead).
 * - Without search, focus stays on the trigger and `aria-activedescendant` points at the
 *   active option. With search, focus moves into the popup's search input (an editable
 *   `combobox` with `aria-autocomplete="list"`), which then carries `aria-activedescendant`.
 * - Down/Up move, Home/End jump (without search), Page Up/Down move by ten, Enter (and Space
 *   without search) picks, Esc closes and returns focus to the trigger, Tab closes and moves
 *   on. A single pick closes; multiple selection stays open.
 *
 * It renders exactly what it is given: callers build the items and decide what a pick does.
 */

export interface ListItem {
  /** Stable React key (and part of the option's DOM id). */
  key: string;
  label: string;
  /** Matched by type-ahead besides the label (e.g. an issue key, an email). */
  keywords?: string;
  /** Shown before the label: icon, avatar or colour dot. Decorative. */
  icon?: React.ReactNode;
  /** Muted text after the label. */
  detail?: string;
  disabled?: boolean;
  selected: boolean;
}

export interface ListboxTriggerProps {
  /** For `<label htmlFor>`; the trigger then takes its name from that label. */
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  disabled?: boolean;
  className?: string;
  /** `field` looks like an input (forms, side panels); `chip` like a small outline button. */
  variant?: "field" | "chip";
}

export interface ListboxPopoverProps extends ListboxTriggerProps {
  /** Names the listbox (and the search input: "Search <label>"). */
  label: string;
  items: ListItem[];
  /** The user picked `items[index]`. */
  onPick: (index: number) => void;
  /** Keeps the popup open after a pick, and marks the listbox multiselectable. */
  multiple?: boolean;
  /** Show a search input; the caller filters (or loads) `items` from `query`. */
  searchable?: boolean;
  query?: string;
  onQueryChange?: (query: string) => void;
  searchPlaceholder?: string;
  /** Announced below the options, e.g. "Searching…" or "No matches". */
  status?: string | null;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
  contentClassName?: string;
  /** Trigger content: the current value, or a placeholder. */
  children: React.ReactNode;
}

const TYPEAHEAD_RESET_MS = 500;
const PAGE = 10;

const triggerVariants = {
  field:
    "flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent py-1 pr-2 pl-2 text-left text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[state=open]:border-ring dark:bg-input/30",
  chip: "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border bg-background px-3 text-sm font-medium whitespace-nowrap shadow-xs transition-all outline-none hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-accent dark:border-input dark:bg-input/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
} as const;

const isPrintable = (event: React.KeyboardEvent) =>
  event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

function firstEnabled(items: ListItem[], from: number, step: 1 | -1): number {
  for (let i = from; i >= 0 && i < items.length; i += step) {
    if (!items[i]?.disabled) return i;
  }
  return -1;
}

export function ListboxPopover({
  label,
  items,
  onPick,
  multiple = false,
  searchable = false,
  query = "",
  onQueryChange,
  searchPlaceholder = "Search…",
  status = null,
  onOpenChange,
  align = "start",
  contentClassName,
  children,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  disabled = false,
  className,
  variant = "field",
}: ListboxPopoverProps) {
  const [open, setOpenState] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  // Whether closing should put focus back on the trigger (not after an outside click or Tab).
  const returnFocus = React.useRef(true);
  const typeahead = React.useRef({ text: "", timer: 0 });
  const baseId = React.useId();
  const listId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const active = activeIndex >= 0 && activeIndex < items.length ? activeIndex : -1;
  const activeId = open && active >= 0 ? optionId(active) : undefined;

  /** Opens or closes; when opening, returns the option that starts out active. */
  function setOpen(next: boolean, initial: "selected" | "first" | "last" = "selected"): number {
    if (next === open) return active;
    let start = -1;
    if (next) {
      const selected = items.findIndex((item) => item.selected && !item.disabled);
      start =
        initial === "last"
          ? firstEnabled(items, items.length - 1, -1)
          : initial === "selected" && selected >= 0
            ? selected
            : firstEnabled(items, 0, 1);
      setActiveIndex(start);
      returnFocus.current = true;
    } else {
      onQueryChange?.("");
    }
    setOpenState(next);
    onOpenChange?.(next);
    return start;
  }

  function close(focusTrigger: boolean) {
    returnFocus.current = focusTrigger;
    setOpen(false);
  }

  function pick(index: number) {
    const item = items[index];
    if (!item || item.disabled) return;
    onPick(index);
    if (!multiple) close(true);
  }

  function move(delta: number) {
    if (items.length === 0) return;
    const from = active < 0 ? (delta > 0 ? -1 : items.length) : active;
    const target = Math.max(0, Math.min(items.length - 1, from + delta));
    const step = delta > 0 ? 1 : -1;
    const next = firstEnabled(items, target, step);
    setActiveIndex(next >= 0 ? next : firstEnabled(items, target, step === 1 ? -1 : 1));
  }

  /**
   * Type-ahead (no search input): jump to the next option starting with what was typed.
   * `from` is the active option (passed in when typing opened the list this very event).
   */
  function typeTo(char: string, from = active) {
    const state = typeahead.current;
    window.clearTimeout(state.timer);
    state.text += char.toLowerCase();
    state.timer = window.setTimeout(() => (state.text = ""), TYPEAHEAD_RESET_MS);
    const repeated = state.text.split("").every((c) => c === state.text[0]);
    const search = repeated ? (state.text[0] ?? "") : state.text;
    const start = repeated ? from + 1 : Math.max(from, 0);
    for (let offset = 0; offset < items.length; offset += 1) {
      const index = (start + offset) % items.length;
      const item = items[index];
      if (!item || item.disabled) continue;
      const haystack = `${item.label}\u0000${item.keywords ?? ""}`.toLowerCase();
      if (haystack.startsWith(search) || haystack.includes(`\u0000${search}`)) {
        setActiveIndex(index);
        return index;
      }
    }
    return -1;
  }

  // aria-activedescendant moves no real focus, so keep the active option in view.
  React.useEffect(() => {
    if (!activeId) return;
    const element = document.getElementById(activeId);
    if (element && typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "nearest" });
    }
  }, [activeId]);

  React.useEffect(() => () => window.clearTimeout(typeahead.current.timer), []);

  /** Keys while open; shared by the trigger (no search) and the search input. */
  function onOpenKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        // Alt+Up: pick and close (APG).
        if (event.altKey) {
          if (active >= 0) pick(active);
          else close(true);
          return;
        }
        move(-1);
        return;
      case "PageDown":
        event.preventDefault();
        move(PAGE);
        return;
      case "PageUp":
        event.preventDefault();
        move(-PAGE);
        return;
      case "Home":
      case "End":
        // In the search input Home/End move the caret.
        if (searchable) return;
        event.preventDefault();
        setActiveIndex(
          event.key === "Home"
            ? firstEnabled(items, 0, 1)
            : firstEnabled(items, items.length - 1, -1),
        );
        return;
      case "Enter":
        event.preventDefault();
        if (active >= 0) pick(active);
        return;
      case " ":
        if (searchable) return;
        event.preventDefault();
        // Mid type-ahead ("in p…") a space is part of the text, not a pick (APG).
        if (typeahead.current.text) typeTo(" ");
        else if (active >= 0) pick(active);
        return;
      case "Tab":
        // Close and let Tab move on from the trigger. Synchronously: while the popup is
        // mounted its focus scope pauses an enclosing dialog's focus trap, and this Tab must
        // see the trap again (or it could leave the modal).
        if (searchable) triggerRef.current?.focus();
        flushSync(() => close(false));
        return;
      default:
        if (!searchable && isPrintable(event)) {
          event.preventDefault();
          typeTo(event.key);
        }
    }
  }

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (open) {
      // With search, focus is in the input; keys reach the trigger only without search.
      if (!searchable) onOpenKeyDown(event);
      return;
    }
    switch (event.key) {
      case "Enter":
      case " ":
      case "ArrowDown":
        event.preventDefault();
        setOpen(true);
        return;
      case "ArrowUp":
        event.preventDefault();
        setOpen(true, "last");
        return;
      default:
        if (!isPrintable(event)) return;
        event.preventDefault();
        if (searchable) {
          // Start searching with what was typed.
          setOpen(true, "first");
          onQueryChange?.(event.key);
        } else {
          typeTo(event.key, setOpen(true));
        }
    }
  }

  const hasItems = items.length > 0;

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close(returnFocus.current);
      }}
    >
      <PopoverPrimitive.Anchor asChild>
        <button
          ref={triggerRef}
          type="button"
          id={id}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={searchable ? undefined : activeId}
          aria-label={ariaLabel ?? (id || ariaLabelledBy ? undefined : label)}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid || undefined}
          disabled={disabled}
          data-state={open ? "open" : "closed"}
          className={cn(triggerVariants[variant], className)}
          onClick={() => setOpen(!open)}
          onKeyDown={onTriggerKeyDown}
          // Space activates buttons on keyup; it is handled on keydown above.
          onKeyUp={(event) => {
            if (event.key === " ") event.preventDefault();
          }}
        >
          {children}
        </button>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          side="bottom"
          sideOffset={4}
          collisionPadding={8}
          data-slot="listbox-popover"
          className={cn(
            "z-50 flex max-h-(--radix-popover-content-available-height) w-max max-w-[min(28rem,calc(100vw-1rem))] min-w-(--radix-popover-trigger-width) flex-col overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md outline-none",
            contentClassName,
          )}
          onOpenAutoFocus={(event) => {
            // Without search the trigger keeps focus (aria-activedescendant).
            event.preventDefault();
            const input = inputRef.current;
            if (!searchable || !input) return;
            input.focus();
            // A search started by typing on the trigger continues after that character.
            input.setSelectionRange(input.value.length, input.value.length);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current) triggerRef.current?.focus();
          }}
          onEscapeKeyDown={() => {
            returnFocus.current = true;
          }}
          onInteractOutside={(event) => {
            // The trigger toggles on its own click; do not close first and reopen.
            if (event.target instanceof Node && triggerRef.current?.contains(event.target)) {
              event.preventDefault();
              return;
            }
            returnFocus.current = false;
          }}
        >
          {searchable ? (
            <div className="flex items-center gap-2 border-b px-2">
              <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-label={`Search ${label}`}
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={activeId}
                autoComplete="off"
                spellCheck={false}
                value={query}
                placeholder={searchPlaceholder}
                className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onChange={(event) => {
                  onQueryChange?.(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={(event) => {
                  // Enter while composing (IME) confirms the composition, not an option.
                  if (event.nativeEvent.isComposing) return;
                  onOpenKeyDown(event);
                }}
              />
            </div>
          ) : null}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            aria-multiselectable={multiple || undefined}
            tabIndex={-1}
            className={cn(
              "max-h-72 overflow-y-auto overscroll-contain p-1 outline-none",
              !hasItems && "hidden",
            )}
          >
            {items.map((item, index) => (
              <li
                key={item.key}
                id={optionId(index)}
                role="option"
                aria-selected={item.selected}
                aria-disabled={item.disabled || undefined}
                data-active={index === active || undefined}
                className={cn(
                  "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm select-none data-[active]:bg-accent data-[active]:text-accent-foreground",
                  item.disabled && "pointer-events-none opacity-50",
                )}
                // Keep focus where it is (trigger or search input).
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => {
                  if (index !== active && !item.disabled) setActiveIndex(index);
                }}
                onClick={() => pick(index)}
              >
                {item.icon ? (
                  <span aria-hidden="true" className="flex shrink-0 items-center">
                    {item.icon}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.detail ? (
                  <span className="shrink-0 text-xs text-muted-foreground">{item.detail}</span>
                ) : null}
                {item.selected ? (
                  <Check
                    aria-hidden="true"
                    className="absolute right-2 size-4 text-foreground"
                    data-testid="option-check"
                  />
                ) : null}
              </li>
            ))}
          </ul>
          <p
            role="status"
            aria-live="polite"
            className={cn("px-3 py-2 text-sm text-muted-foreground", !status && "sr-only")}
          >
            {status}
          </p>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
