import { env } from "@/env";
import { createCronMonthlyHandler } from "@/server/cron/monthly";
import { costReminderJob } from "@/server/services";

/**
 * COST-7 monthly jobs (today: the costs reminder), scheduled DAILY by the `crons` entry in
 * vercel.json; the job decides when each project's reminder day has come. Public in the
 * proxy because Vercel Cron holds no session; every request must carry
 * `Authorization: Bearer <CRON_SECRET>`, compared in constant time. Without CRON_SECRET it
 * answers 503 and does nothing (fail closed). Vercel calls it with GET; POST is the same.
 */
const handler = createCronMonthlyHandler({
  // Read per request, so a secret set later takes effect without a code change.
  secret: () => env.CRON_SECRET,
  costReminders: () => costReminderJob,
});

export const GET = handler;
export const POST = handler;

// Never prerendered or cached: every call is a run.
export const dynamic = "force-dynamic";
// One statement; far below every Vercel plan's limit.
export const maxDuration = 30;
