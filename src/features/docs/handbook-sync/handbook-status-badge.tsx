import { HANDBOOK_SYNC_LABELS, type HandbookSyncStatus } from "@/lib/handbook/constants";
import { cn } from "@/lib/utils";

/**
 * DOC-14 sync status of one doc, from stored state only (no GitHub call). No "use client":
 * renders on the server (doc page) and inside client components (settings table) alike.
 * The docs-UX slice's header badges slot can take it as is.
 */

const TONES: Record<HandbookSyncStatus, string> = {
  not_in_handbook: "border-border text-muted-foreground",
  in_sync: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  changed_in_hq: "border-sky-600/40 text-sky-700 dark:text-sky-400",
  changed_in_handbook: "border-amber-600/40 text-amber-700 dark:text-amber-400",
  both_changed: "border-red-600/40 text-red-700 dark:text-red-400",
  pr_open: "border-violet-600/40 text-violet-700 dark:text-violet-400",
  removed_in_handbook: "border-red-600/40 text-red-700 dark:text-red-400",
};

const HINTS: Record<HandbookSyncStatus, string> = {
  not_in_handbook: "This doc has never been published to the handbook repo",
  in_sync: "HQ and the handbook repo have the same content",
  changed_in_hq: "Edited in HQ since the last publish or pull",
  changed_in_handbook: "The handbook repo changed since the last sync: review and pull",
  both_changed: "Changed in HQ and in the handbook repo: review before publishing or pulling",
  pr_open: "A publish pull request is open",
  removed_in_handbook: "The file was removed from the handbook repo",
};

export function HandbookStatusBadge({
  status,
  pr,
  className,
}: {
  status: HandbookSyncStatus;
  pr?: { number: number | null; url: string | null } | null;
  className?: string;
}) {
  const base = cn(
    "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
    TONES[status],
    className,
  );
  if (status === "pr_open" && pr?.url && pr.number !== null) {
    return (
      <a
        href={pr.url}
        target="_blank"
        rel="noopener noreferrer"
        title={HINTS[status]}
        className={cn(
          base,
          "outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50",
        )}
      >
        {HANDBOOK_SYNC_LABELS[status]} #{pr.number}
      </a>
    );
  }
  return (
    <span className={base} title={HINTS[status]}>
      {status === "pr_open" ? "Publishing…" : HANDBOOK_SYNC_LABELS[status]}
    </span>
  );
}
