"use client";

import { useState } from "react";

import { type LineDiffHunk } from "@/lib/text/line-diff";
import { cn } from "@/lib/utils";

/**
 * The one renderer for a `lineDiff` result (DOC-10 version history, DOC-14 publish and pull
 * dialogs). Added and removed lines are coloured AND carry a `+` / `−` marker plus a
 * screen-reader label, so the change never depends on colour alone. Long unchanged runs are
 * collapsed behind a button that shows them. Text only, never HTML.
 */

const MARKERS = { add: "+", remove: "−", equal: " " } as const;
const LABELS = { add: "Added", remove: "Removed", equal: "Unchanged" } as const;

export function diffSummary(hunks: readonly LineDiffHunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    if (hunk.kind === "add") added += hunk.lines;
    if (hunk.kind === "remove") removed += hunk.lines;
  }
  return { added, removed };
}

export function LineDiffView({
  hunks,
  oldLabel,
  newLabel,
  label = `Changes from ${oldLabel} to ${newLabel}`,
  className,
}: {
  hunks: readonly LineDiffHunk[];
  oldLabel: string;
  newLabel: string;
  /** The listing's accessible name. */
  label?: string;
  /** Extra classes for the listing (e.g. a max height inside a dialog). */
  className?: string;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const { added, removed } = diffSummary(hunks);

  if (added === 0 && removed === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No differences between {oldLabel} and {newLabel}.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {oldLabel} → {newLabel}: <span className="text-foreground">+{added}</span> added,{" "}
        <span className="text-foreground">−{removed}</span> removed lines
      </p>
      <ol
        aria-label={label}
        className={cn("overflow-x-auto rounded-md border font-mono text-xs leading-5", className)}
      >
        {hunks.map((hunk, index) => {
          if (hunk.collapsed && !expanded.has(index)) {
            return (
              <li key={index} className="border-y bg-muted/40 first:border-t-0 last:border-b-0">
                <button
                  type="button"
                  className="w-full px-3 py-1 text-left text-muted-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  onClick={() => setExpanded((current) => new Set(current).add(index))}
                >
                  Show {hunk.lines} unchanged {hunk.lines === 1 ? "line" : "lines"}
                </button>
              </li>
            );
          }
          // `text` is the lines joined with "\n", so this keeps empty lines too.
          return hunk.text.split("\n").map((line, lineIndex) => (
            <li
              key={`${index}:${lineIndex}`}
              data-kind={hunk.kind}
              className={cn(
                "flex whitespace-pre",
                hunk.kind === "add" && "bg-emerald-500/15",
                hunk.kind === "remove" && "bg-red-500/15",
              )}
            >
              <span aria-hidden="true" className="w-6 shrink-0 text-center text-muted-foreground">
                {MARKERS[hunk.kind]}
              </span>
              {hunk.kind === "equal" ? null : (
                <span className="sr-only">{LABELS[hunk.kind]}: </span>
              )}
              <span className="pr-3">{line === "" ? " " : line}</span>
            </li>
          ));
        })}
      </ol>
    </div>
  );
}
