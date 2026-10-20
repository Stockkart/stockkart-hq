"use client";

import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  EllipsisVertical,
} from "lucide-react";

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
}: {
  itemLabel: string;
  available: Record<MoveKind, boolean>;
  onMove: (kind: MoveKind) => void;
  /** Extra menu items after the move entries. */
  children?: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Actions for ${itemLabel}`}
        >
          <EllipsisVertical aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
