import { type DigestFrequency } from "@/lib/notifications/constants";

/**
 * NTF-2: when a user's digest is due, and which period it covers. Pure (tests pass `now`).
 *
 * The job runs once a day (a vercel.json cron; disabled for now, see README). Vercel Hobby runs a daily cron "at any point
 * within the specified hour" (https://vercel.com/docs/cron-jobs/manage-cron-jobs), so two
 * runs can be as little as ~23 h apart. A period therefore counts as complete a little
 * early (`DUE_TOLERANCE_MS`); otherwise a run at 08:05 after one at 08:50 the day before
 * would skip a whole day.
 *
 * - daily: due when the last digest is at least 24 h (minus the tolerance) old;
 * - weekly: due on Mondays (UTC) when the last digest is at least 7 days (minus the
 *   tolerance) old;
 * - never sent: due at once (weekly: on a Monday).
 */

const HOUR_MS = 60 * 60 * 1000;
export const PERIOD_MS: Record<DigestFrequency, number> = {
  daily: 24 * HOUR_MS,
  weekly: 7 * 24 * HOUR_MS,
};
export const DUE_TOLERANCE_MS = 2 * HOUR_MS;
const MONDAY = 1;

export interface DigestUser {
  frequency: DigestFrequency;
  lastDigestAt: Date | null;
}

export function isDigestDue(user: DigestUser, now: Date): boolean {
  if (user.frequency === "weekly" && now.getUTCDay() !== MONDAY) return false;
  if (!user.lastDigestAt) return true;
  return (
    now.getTime() - user.lastDigestAt.getTime() >= PERIOD_MS[user.frequency] - DUE_TOLERANCE_MS
  );
}

/**
 * Start of the period to send: the end of the last one (`last_digest_at`), so periods
 * never overlap even when the frequency changes. Without one (opted in before NTF-2
 * shipped), one period back from the start of today (UTC): deterministic for the whole
 * day, so two runs that day claim the SAME period and only one sends.
 */
export function periodStartFor(user: DigestUser, now: Date): Date {
  if (user.lastDigestAt) return user.lastDigestAt;
  const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(startOfDay - PERIOD_MS[user.frequency]);
}
