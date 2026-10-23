"use client";

import { useEffect, useRef, useState } from "react";

import { KEYBOARD_SAVE_DELAY_MS } from "@/lib/roadmap/constants";
import { type EpicProgress } from "@/lib/roadmap/progress";
import {
  applyBarEdit,
  type BarEdit,
  dragDays,
  keyboardBarEdit,
  rangeDays,
  sameRange,
} from "@/lib/roadmap/schedule";
import { type DateRange } from "@/lib/roadmap/views";
import { daysBetween, formatDateRange } from "@/lib/sprints/dates";
import { cn } from "@/lib/utils";

type DragMode = BarEdit["kind"];

/** Below this width the 8 px edge handles would cover the whole bar. */
const MIN_HANDLE_BAR_WIDTH = 24;

interface Drag {
  mode: DragMode;
  pointerId: number;
  startX: number;
  base: DateRange;
  moved: boolean;
}

/**
 * One epic's bar on the RDM-1 timeline. Drag the bar to move it, or an edge to change that
 * date; the change is saved on drop. Keyboard alternative (focus the bar): ←/→ move it by
 * a day, Shift by a week, Alt+←/→ moves the end date; the nudges are saved together once
 * the keys rest (or on blur), Escape undoes unsaved nudges, and Enter opens the date
 * editor. While dragging or nudging the bar shows a local draft; the parent then shows the
 * saved range optimistically and rolls it back if the save fails.
 */
export function EpicBar({
  epicKey,
  title,
  range,
  windowStart,
  dayWidth,
  progress,
  conflict,
  describedBy,
  onCommit,
  onEdit,
}: {
  epicKey: string;
  title: string;
  range: DateRange;
  windowStart: string;
  dayWidth: number;
  progress: EpicProgress;
  /** RDM-2: part of a dependency whose blocker ends after the blocked epic starts. */
  conflict: boolean;
  /** Id of the shared keyboard instructions. */
  describedBy: string;
  onCommit: (range: DateRange) => void;
  onEdit: () => void;
}) {
  const [draft, setDraft] = useState<DateRange | null>(null);
  const drag = useRef<Drag | null>(null);
  // A drag ends with a click on the bar; that click must not open the date editor.
  const suppressClick = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest draft, for the debounced keyboard save and blur.
  const pending = useRef<DateRange | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const shown = draft ?? range;
  const left = daysBetween(windowStart, shown.start) * dayWidth;
  const width = Math.max(rangeDays(shown) * dayWidth, 6);

  function commit(next: DateRange | null) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    setDraft(null);
    if (next && !sameRange(next, range)) onCommit(next);
  }

  function nudge(next: DateRange) {
    pending.current = next;
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(pending.current), KEYBOARD_SAVE_DELAY_MS);
  }

  function startDrag(mode: DragMode, event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressClick.current = false;
    drag.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      base: pending.current ?? range,
      moved: false,
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const days = dragDays(event.clientX - current.startX, dayWidth);
    if (days !== 0) current.moved = true;
    if (!current.moved) return;
    setDraft(applyBarEdit(current.base, { kind: current.mode, days }));
  }

  function onPointerUp(event: React.PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!current.moved) return;
    // The click that ends a dragged bar must not open the date editor. An edge drag ends
    // on its handle, not the button, so it gets no click and sets nothing.
    suppressClick.current = current.mode === "move";
    const days = dragDays(event.clientX - current.startX, dayWidth);
    commit(applyBarEdit(current.base, { kind: current.mode, days }));
  }

  function onPointerCancel() {
    drag.current = null;
    setDraft(null);
  }

  const handlers = { onPointerMove, onPointerUp, onPointerCancel };
  const label = `${epicKey} ${title}: ${formatDateRange(shown.start, shown.end)}, ${progress.percent === null ? progress.label : `${progress.percent}% done (${progress.label})`}${conflict ? ", dependency conflict" : ""}`;

  return (
    <div
      className="absolute top-1/2 h-7 -translate-y-1/2 touch-none"
      style={{ left, width }}
      {...handlers}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={describedBy}
        title={`${epicKey}: ${formatDateRange(shown.start, shown.end)}`}
        className={cn(
          "relative flex size-full cursor-grab items-center overflow-hidden rounded-md border border-primary/50 bg-primary/15 text-left text-xs outline-none active:cursor-grabbing",
          "focus-visible:ring-[3px] focus-visible:ring-ring/60",
          conflict && "border-destructive ring-1 ring-destructive",
          draft && "shadow-md",
        )}
        onPointerDown={(event) => startDrag("move", event)}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          // Save unsaved nudges first, so the editor opens on (and saves from) them.
          if (pending.current) commit(pending.current);
          onEdit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && draft) {
            event.preventDefault();
            commit(null);
            return;
          }
          const edit = keyboardBarEdit(event);
          if (!edit) return;
          event.preventDefault();
          nudge(applyBarEdit(pending.current ?? range, edit));
        }}
        onBlur={() => {
          if (pending.current) commit(pending.current);
        }}
      >
        {progress.percent !== null ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 bg-primary/45"
            style={{ width: `${progress.percent}%` }}
          />
        ) : null}
        <span aria-hidden="true" className="relative truncate px-2 font-medium">
          {progress.percent !== null ? `${progress.percent}%` : ""}
        </span>
      </button>
      {/* Edge handles (pointer only; the keyboard resizes with Alt+arrows or Enter). A bar too
          short for them stays draggable as a whole and is resized in the date editor. */}
      {width >= MIN_HANDLE_BAR_WIDTH ? (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-md hover:bg-primary/40"
            onPointerDown={(event) => startDrag("resizeStart", event)}
          />
          <span
            aria-hidden="true"
            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md hover:bg-primary/40"
            onPointerDown={(event) => startDrag("resizeEnd", event)}
          />
        </>
      ) : null}
    </div>
  );
}
