import { HANDBOOK_PUBLIC_WARNING } from "@/lib/handbook/constants";
import { type LineDiffHunk } from "@/lib/text/line-diff";
import { cn } from "@/lib/utils";

/**
 * A `lineDiff` result as a scrollable listing (DOC-14 publish / pull dialogs). Collapsed
 * runs show as "N unchanged lines". Text only, never HTML.
 */
export function DiffView({
  hunks,
  label,
  oldLabel,
  newLabel,
}: {
  hunks: LineDiffHunk[];
  label: string;
  oldLabel: string;
  newLabel: string;
}) {
  if (hunks.every((hunk) => hunk.kind === "equal")) {
    return <p className="text-sm text-muted-foreground">No differences.</p>;
  }
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-xs text-muted-foreground">
        {label}: <span className="text-red-700 dark:text-red-400">− {oldLabel}</span>{" "}
        <span className="text-emerald-700 dark:text-emerald-400">+ {newLabel}</span>
      </figcaption>
      <pre
        tabIndex={0}
        aria-label={label}
        className="max-h-80 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs leading-5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {hunks.map((hunk, index) =>
          hunk.collapsed ? (
            <div key={index} className="text-muted-foreground italic">
              … {hunk.lines} unchanged {hunk.lines === 1 ? "line" : "lines"}
            </div>
          ) : (
            hunk.text.split("\n").map((line, lineIndex) => (
              <div
                key={`${index}:${lineIndex}`}
                className={cn(
                  hunk.kind === "add" && "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
                  hunk.kind === "remove" && "bg-red-500/10 text-red-800 dark:text-red-300",
                )}
              >
                <span aria-hidden="true" className="select-none">
                  {hunk.kind === "add" ? "+ " : hunk.kind === "remove" ? "− " : "  "}
                </span>
                <span className="sr-only">
                  {hunk.kind === "add" ? "added: " : hunk.kind === "remove" ? "removed: " : ""}
                </span>
                {line}
              </div>
            ))
          ),
        )}
      </pre>
    </figure>
  );
}

/** The public-repo warning shown before every publish. */
export function PublicRepoWarning() {
  return (
    <p
      role="note"
      className="rounded-md border border-amber-600/40 bg-amber-500/10 p-2 text-sm text-amber-900 dark:text-amber-200"
    >
      <strong>Public repo.</strong> {HANDBOOK_PUBLIC_WARNING}
    </p>
  );
}
