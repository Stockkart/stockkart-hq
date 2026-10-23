import { env } from "@/env";
import { db, runAtomic } from "@/server/db/client";
import { createNotificationQueries } from "@/server/services/notification-queries";

import { emailConfigFrom } from "./config";
import { createDigestJob, type DigestJob } from "./digest";
import { createResendSender } from "./resend";
import { createUnsubscribeService } from "./unsubscribe";

/**
 * Wiring only (server-only: imports `@/env` and the database). NTF-2 email digest and the
 * one-click unsubscribe. Tests build the same pieces with fakes.
 */

/** Whether digests can be sent (all three Resend variables are set). */
export function emailConfigured(): boolean {
  return emailConfigFrom(env) !== null;
}

/** The digest job, or null while email is not configured (fail closed). */
export function digestJob(): DigestJob | null {
  const config = emailConfigFrom(env);
  if (!config) return null;
  return createDigestJob({
    db,
    // Unbatched reads: the job is not a page render.
    notificationQueries: createNotificationQueries(db),
    send: createResendSender({ apiKey: config.apiKey }),
    config: { from: config.from, baseUrl: config.baseUrl },
  });
}

export const unsubscribeService = createUnsubscribeService(db, { runAtomic });

export { EMAIL_NOT_CONFIGURED_MESSAGE } from "./config";
