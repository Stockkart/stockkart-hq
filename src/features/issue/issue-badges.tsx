import {
  BookOpen,
  Bug,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CornerDownRight,
  Layers,
  type LucideIcon,
  SignalHigh,
  SignalLow,
  SignalMedium,
  SquareCheck,
  TriangleAlert,
  Wrench,
  Zap,
} from "lucide-react";

import {
  ISSUE_TYPE_LABELS,
  type IssueType,
  type Priority,
  PRIORITY_LABELS,
  type StatusCategory,
} from "@/lib/issues/constants";
import { cn } from "@/lib/utils";

/** Type, priority and status markers. Colour is never the only signal: each has a label. */

const TYPE_ICONS: Record<IssueType, { icon: LucideIcon; className: string }> = {
  epic: { icon: Layers, className: "text-violet-600 dark:text-violet-400" },
  story: { icon: BookOpen, className: "text-emerald-600 dark:text-emerald-400" },
  task: { icon: SquareCheck, className: "text-sky-600 dark:text-sky-400" },
  bug: { icon: Bug, className: "text-red-600 dark:text-red-400" },
  spike: { icon: Zap, className: "text-amber-600 dark:text-amber-400" },
  tech_debt: { icon: Wrench, className: "text-slate-600 dark:text-slate-300" },
  subtask: { icon: CornerDownRight, className: "text-sky-600 dark:text-sky-400" },
};

export function IssueTypeIcon({
  type,
  className,
  withLabel = false,
}: {
  type: IssueType;
  className?: string;
  /** Visible label next to the icon; otherwise the label is for screen readers only. */
  withLabel?: boolean;
}) {
  const { icon: Icon, className: color } = TYPE_ICONS[type];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      title={ISSUE_TYPE_LABELS[type]}
    >
      <Icon aria-hidden="true" className={cn("size-4 shrink-0", color)} />
      <span className={withLabel ? undefined : "sr-only"}>{ISSUE_TYPE_LABELS[type]}</span>
    </span>
  );
}

/** The type icon alone (decorative), e.g. inside a picker option that already says the type. */
export function IssueTypeGlyph({ type }: { type: IssueType }) {
  const { icon: Icon, className: color } = TYPE_ICONS[type];
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", color)} />;
}

const PRIORITY_ICONS: Record<Priority, { icon: LucideIcon; className: string }> = {
  0: { icon: TriangleAlert, className: "text-red-600 dark:text-red-400" },
  1: { icon: SignalHigh, className: "text-orange-600 dark:text-orange-400" },
  2: { icon: SignalMedium, className: "text-muted-foreground" },
  3: { icon: SignalLow, className: "text-muted-foreground" },
};

export function PriorityLabel({
  priority,
  short = false,
  className,
}: {
  priority: Priority;
  /** "P1" instead of "P1 High" (the full label stays available to screen readers). */
  short?: boolean;
  className?: string;
}) {
  const { icon: Icon, className: color } = PRIORITY_ICONS[priority];
  const label = PRIORITY_LABELS[priority];
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm", className)} title={label}>
      <Icon aria-hidden="true" className={cn("size-4 shrink-0", color)} />
      {short ? (
        <>
          <span aria-hidden="true">P{priority}</span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        <span>{label}</span>
      )}
    </span>
  );
}

/** The priority icon alone (decorative). */
export function PriorityGlyph({ priority }: { priority: Priority }) {
  const { icon: Icon, className: color } = PRIORITY_ICONS[priority];
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", color)} />;
}

const STATUS_STYLES: Record<StatusCategory, { icon: LucideIcon; className: string }> = {
  todo: { icon: CircleDashed, className: "text-muted-foreground" },
  in_progress: { icon: CircleDot, className: "text-sky-600 dark:text-sky-400" },
  done: { icon: CircleCheck, className: "text-emerald-600 dark:text-emerald-400" },
};

export function StatusBadge({
  name,
  category,
  className,
}: {
  name: string;
  category: StatusCategory;
  className?: string;
}) {
  const { icon: Icon, className: color } = STATUS_STYLES[category];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn("size-3.5", color)} />
      {name}
    </span>
  );
}

/** The status category icon alone (decorative). */
export function StatusGlyph({ category }: { category: StatusCategory }) {
  const { icon: Icon, className: color } = STATUS_STYLES[category];
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", color)} />;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase() || "?";
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      title={name}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
