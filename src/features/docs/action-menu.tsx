"use client";

import { MoreHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface MenuAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

/**
 * A small ARIA menu button (WAI-ARIA "menu button" pattern): Enter/Space/ArrowDown opens it,
 * arrow keys move, Escape or Tab closes and returns focus. Used for tree-row actions, where
 * "Move to…" is the keyboard alternative to drag and drop (§9.5).
 */
export function ActionMenu({
  label,
  actions,
  className,
}: {
  label: string;
  actions: MenuAction[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const menuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    items.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function close(refocus = true) {
    setOpen(false);
    if (refocus) button.current?.focus();
  }

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setActive(0);
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive(0);
            setOpen(true);
          }
        }}
        className="rounded p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <MoreHorizontal aria-hidden="true" className="size-3.5" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute top-full right-0 z-20 mt-1 flex min-w-40 flex-col rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          onKeyDown={(event) => {
            const last = actions.length - 1;
            const moves: Record<string, number> = {
              ArrowDown: active >= last ? 0 : active + 1,
              ArrowUp: active <= 0 ? last : active - 1,
              Home: 0,
              End: last,
            };
            const next = moves[event.key];
            if (next !== undefined) {
              event.preventDefault();
              setActive(next);
            } else if (event.key === "Escape") {
              event.preventDefault();
              close();
            } else if (event.key === "Tab") {
              close(false);
            }
          }}
        >
          {actions.map((action, index) => (
            <button
              key={action.label}
              ref={(element) => {
                items.current[index] = element;
              }}
              type="button"
              role="menuitem"
              tabIndex={index === active ? 0 : -1}
              onClick={() => {
                close(false);
                action.onSelect();
              }}
              className={cn(
                "rounded px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
                action.destructive && "text-destructive",
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
