"use client";

import { cn } from "@/lib/utils";

const CHECKBOX =
  "size-4 shrink-0 cursor-pointer rounded-sm accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * ISS-12 row checkbox. Space or a click toggles it; with Shift held, the whole range from
 * the last toggled row (keyboard Shift+Space too: the browser reports it as a click).
 */
export function RowCheckbox({
  label,
  checked,
  onToggle,
  className,
}: {
  label: string;
  checked: boolean;
  onToggle: (range: boolean) => void;
  className?: string;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      className={cn(CHECKBOX, className)}
      onChange={(event) =>
        onToggle(event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey)
      }
    />
  );
}

/** "Select all visible": checked when all are, mixed when some are. */
export function SelectAllCheckbox({
  label,
  all,
  some,
  onChange,
}: {
  label: string;
  all: boolean;
  some: boolean;
  onChange: (selectAll: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={all}
      aria-checked={some && !all ? "mixed" : all}
      ref={(element) => {
        if (element) element.indeterminate = some && !all;
      }}
      className={CHECKBOX}
      onChange={() => onChange(!all)}
    />
  );
}
