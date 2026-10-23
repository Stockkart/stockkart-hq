import { type ReleaseSummary } from "@/lib/releases/views";

const pts = (value: number) => `${value} ${value === 1 ? "pt" : "pts"}`;

/** "3 of 5 issues done · 8 of 13 pts" plus a bar (REL-1 progress). Server-safe. */
export function ReleaseProgress({ release }: { release: Pick<ReleaseSummary, "total" | "done"> }) {
  const { total, done } = release;
  const percent = total.count === 0 ? 0 : Math.round((done.count / total.count) * 100);
  return (
    <div className="flex min-w-48 flex-col gap-1">
      <div
        role="progressbar"
        aria-label="Issues done"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${done.count} of ${total.count} issues done`}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {done.count} of {total.count} {total.count === 1 ? "issue" : "issues"} done · {done.points}{" "}
        of {pts(total.points)}
      </p>
    </div>
  );
}

/** A release's dates as one line: target date, or when it was released. */
export function releaseDateLine(
  release: Pick<ReleaseSummary, "state" | "releaseDate" | "releasedAt">,
) {
  if (release.state === "released" && release.releasedAt) {
    return `Released ${release.releasedAt.toISOString().slice(0, 10)}`;
  }
  return release.releaseDate ? `Target ${release.releaseDate}` : "No target date";
}
