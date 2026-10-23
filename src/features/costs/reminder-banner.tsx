import { BellRing } from "lucide-react";
import Link from "next/link";

import { costReminderText } from "@/lib/notifications/format";
import { costsHref } from "@/lib/costs/route";
import { type CostReminder } from "@/lib/costs/views";

/**
 * COST-7 fallback without the cron: "October 2026 costs are not added yet (5 items
 * missing). Add now", on the costs page and as a My Work card. Computed from the page's
 * own batched reads (`costQueries.reminder` / `remindersFor`), so it costs no round trip.
 */
export function CostReminderBanner({
  projectKey,
  reminder,
  className,
}: {
  projectKey: string;
  reminder: CostReminder;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 ${className ?? ""}`}
    >
      <BellRing aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {costReminderText(reminder.month, reminder.missingCount)}.
      </span>
      <Link
        href={costsHref(projectKey, { month: reminder.month })}
        className="font-medium underline underline-offset-4"
      >
        Add now
      </Link>
    </div>
  );
}
