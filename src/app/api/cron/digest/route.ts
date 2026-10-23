import { env } from "@/env";
import { digestJob } from "@/server/email";
import { createCronDigestHandler } from "@/server/email/routes";

/**
 * NTF-2 daily digest job (a `crons` entry in vercel.json; disabled for now, see README). Public in the proxy because Vercel Cron
 * holds no session; every request must carry `Authorization: Bearer <CRON_SECRET>`,
 * compared in constant time. Without CRON_SECRET it answers 503 and does nothing (fail
 * closed). Vercel calls it with GET; POST is the same, for a manual run.
 */
const handler = createCronDigestHandler({
  // Read per request, so a secret set later takes effect without a code change.
  secret: () => env.CRON_SECRET,
  job: digestJob,
});

export const GET = handler;
export const POST = handler;

// Never prerendered or cached: every call is a run.
export const dynamic = "force-dynamic";
// Allowed on every Vercel plan; the job stops starting sends well before it (budgetMs).
export const maxDuration = 60;
