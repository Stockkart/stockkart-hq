import { z } from "zod";

import { EMAIL_ERROR_CODE_MAX } from "@/lib/notifications/constants";

/**
 * NTF-2 sending through Resend's REST API with `fetch` (no SDK, no new dependency):
 * `POST https://api.resend.com/emails` with `Authorization: Bearer <RESEND_API_KEY>`
 * (https://resend.com/docs/api-reference/emails/send-email). Resend refuses requests
 * without a User-Agent (https://resend.com/docs/api-reference/introduction).
 *
 * - every attempt has a timeout;
 * - a 5xx, a timeout or a network error is retried ONCE, with the same `Idempotency-Key`
 *   (the delivery row id), so a retry after a lost response cannot send twice;
 * - a 4xx is final (bad address, unverified domain, quota): `failed` with a short code.
 *
 * Results carry Resend's message id or a short error code only: never the address, the
 * body or Resend's message text (which can echo the address), so nothing personal is logged.
 */

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const RESEND_TIMEOUT_MS = 10_000;

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
  /** Same key on a retry: Resend sends at most once per key (24 h). */
  idempotencyKey: string;
}

export type SendResult = { ok: true; providerId: string } | { ok: false; errorCode: string };

export type SendEmail = (message: EmailMessage) => Promise<SendResult>;

const sentBody = z.object({ id: z.string().min(1).max(200) });
const errorBody = z.object({ name: z.string().regex(/^[a-z_]{1,64}$/) });

type Attempt = SendResult & { retryable: boolean };

export function createResendSender({
  apiKey,
  fetch: fetchImpl = fetch,
  timeoutMs = RESEND_TIMEOUT_MS,
}: {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): SendEmail {
  async function attempt(message: EmailMessage): Promise<Attempt> {
    let response: Response;
    try {
      response = await fetchImpl(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "stockkart-hq",
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          headers: message.headers,
        }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      return { ok: false, errorCode: timedOut ? "timeout" : "network_error", retryable: true };
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      // Not JSON (e.g. a proxy error page): judged by the status alone.
    }
    if (response.ok) {
      const parsed = sentBody.safeParse(json);
      return parsed.success
        ? { ok: true, providerId: parsed.data.id, retryable: false }
        : { ok: false, errorCode: "invalid_response", retryable: false };
    }
    const name = errorBody.safeParse(json);
    const code = name.success ? name.data.name : `http_${response.status}`;
    return {
      ok: false,
      errorCode: code.slice(0, EMAIL_ERROR_CODE_MAX),
      retryable: response.status >= 500,
    };
  }

  return async (message) => {
    let result = await attempt(message);
    if (!result.ok && result.retryable) result = await attempt(message);
    return result.ok
      ? { ok: true, providerId: result.providerId }
      : { ok: false, errorCode: result.errorCode };
  };
}
