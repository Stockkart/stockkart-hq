import type { Metadata } from "next";
import Link from "next/link";

import { RelativeTime } from "@/features/issue/client-utils";
import { IssueTypeIcon, PriorityLabel, StatusBadge } from "@/features/issue/issue-badges";
import { type StatusCategory } from "@/lib/issues/constants";
import { requirePageSession } from "@/server/auth/require-session";
import { planningQueries } from "@/server/services";
import { BOARD_DONE_DAYS } from "@/server/services/planning-queries";

export const metadata: Metadata = { title: "My Work" };

/** Open work first (MY-1). */
const GROUPS: { category: StatusCategory; label: string }[] = [
  { category: "in_progress", label: "In progress" },
  { category: "todo", label: "To do" },
  { category: "done", label: `Done in the last ${BOARD_DONE_DAYS} days` },
];

/**
 * MY-1: issues assigned to me by status category, and recently viewed items. "Mentions"
 * needs @user mention links, which nothing writes yet (only `STK-123` refs are linked),
 * so that section arrives with @mentions.
 */
export default async function MyWorkPage() {
  // Layouts and pages render in parallel, so each page checks the session itself too.
  const session = await requirePageSession();
  const name = session.user.name || session.user.email;
  const [assigned, recent] = await Promise.all([
    planningQueries.listAssignedTo(session.user.id),
    planningQueries.listRecentlyViewed(session.user.id),
  ]);
  const total = assigned.in_progress.length + assigned.todo.length;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">My Work</h1>
        <p className="text-muted-foreground">
          Welcome, <span className="font-medium text-foreground">{name}</span>. You have {total}{" "}
          open {total === 1 ? "issue" : "issues"}.
        </p>
      </div>

      <section aria-labelledby="assigned-heading" className="flex flex-col gap-4">
        <h2 id="assigned-heading" className="text-lg font-medium">
          Assigned to me
        </h2>
        {GROUPS.every(({ category }) => assigned[category].length === 0) ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing is assigned to you. Pick something from the backlog.
          </p>
        ) : (
          GROUPS.filter(({ category }) => assigned[category].length > 0).map(
            ({ category, label }) => (
              <div key={category}>
                <h3 className="mb-1.5 text-sm font-medium text-muted-foreground">
                  {label} ({assigned[category].length})
                </h3>
                <ul className="divide-y rounded-lg border">
                  {assigned[category].map((issue) => (
                    <li key={issue.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <IssueTypeIcon type={issue.type} />
                      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                        {issue.key}
                      </span>
                      <Link
                        href={issue.href}
                        className="min-w-0 flex-1 truncate font-medium hover:underline"
                      >
                        <span className="sr-only">{issue.key}: </span>
                        {issue.title}
                      </Link>
                      <PriorityLabel priority={issue.priority} short />
                      <StatusBadge name={issue.status.name} category={issue.status.category} />
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )
        )}
      </section>

      <section aria-labelledby="recent-heading" className="flex flex-col gap-2">
        <h2 id="recent-heading" className="text-lg font-medium">
          Recently viewed
        </h2>
        {recent.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Issues and docs you open show up here.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {recent.map((item) => (
              <li
                key={`${item.kind}:${item.id}`}
                className="flex items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                  {item.key ?? "Doc"}
                </span>
                <Link href={item.href} className="min-w-0 flex-1 truncate hover:underline">
                  {item.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  <RelativeTime date={item.viewedAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
