import { type Env } from "@/env";

/**
 * NTF-2 email configuration. Fail closed: without ALL of RESEND_API_KEY, RESEND_FROM_EMAIL
 * and APP_BASE_URL there is no sender, the digest job sends nothing (503) and the profile
 * shows `EMAIL_NOT_CONFIGURED_MESSAGE`.
 */

export const EMAIL_NOT_CONFIGURED_MESSAGE =
  "Email isn't set up for this HQ yet, so no digest is sent. Your choice is saved and takes effect once it is.";

export interface EmailConfig {
  apiKey: string;
  from: string;
  baseUrl: string;
}

export function emailConfigFrom(
  env: Pick<Env, "RESEND_API_KEY" | "RESEND_FROM_EMAIL" | "APP_BASE_URL">,
): EmailConfig | null {
  const { RESEND_API_KEY: apiKey, RESEND_FROM_EMAIL: from, APP_BASE_URL: baseUrl } = env;
  return apiKey && from && baseUrl ? { apiKey, from, baseUrl } : null;
}
