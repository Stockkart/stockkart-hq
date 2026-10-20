"use client";

import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  EllipsisVertical,
} from "lucide-react";
import { type Ref } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MOVE_KINDS, MOVE_LABELS, type MoveKind } from "@/lib/planning/reorder";

const ICONS: Record<MoveKind, typeof ChevronUp> = {
  top: ArrowUpToLine,
  up: ChevronUp,
  down: ChevronDown,
  bottom: ArrowDownToLine,
};

/**
 * The keyboard alternative to dragging a row (SPEC §9.5): "Move to top / up / down /
 * bottom". `itemLabel` names the row for screen readers, e.g. "STK-12".
 */
export function MoveMenu({
  itemLabel,
  available,
  onMove,
  children,
  triggerRef,
  keepFocusOnClose,
}: {
  itemLabel: string;
  available: Record<MoveKind, boolean>;
  onMove: (kind: MoveKind) => void;
  /** Extra menu items after the move entries. */
  children?: React.ReactNode;
  triggerRef?: Ref<HTMLButtonElement>;
  /**
   * True when the chosen item moves the row elsewhere (BLG-3 "Move to sprint…"): the row
   * remounts in its new section and takes focus itself, so the menu must not return focus
   * to this (old) trigger.
   */
  keepFocusOnClose?: () => boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Actions for ${itemLabel}`}
        >
          <EllipsisVertical aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (keepFocusOnClose?.()) event.preventDefault();
        }}
      >
        {MOVE_KINDS.map((kind) => {
          const Icon = ICONS[kind];
          return (
            <DropdownMenuItem key={kind} disabled={!available[kind]} onSelect={() => onMove(kind)}>
              <Icon aria-hidden="true" />
              {MOVE_LABELS[kind]}
            </DropdownMenuItem>
          );
        })}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
