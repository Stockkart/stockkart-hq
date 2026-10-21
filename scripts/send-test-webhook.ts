/**
 * Manual local test of the GitHub webhook (GH-1): signs a SYNTHETIC delivery with
 * GITHUB_WEBHOOK_SECRET from the shell and POSTs it to HQ.
 *
 *   GITHUB_WEBHOOK_SECRET='…' pnpm exec tsx scripts/send-test-webhook.ts \
 *     [--url http://127.0.0.1:3000] [--event ping|create|push|pr-opened|pr-merged] \
 *     [--key STK-1] [--pr 1]
 *
 * The secret must be the same value the HQ server runs with. Only https URLs, or plain http
 * to 127.0.0.1/localhost, are accepted. The secret and the signature are never printed.
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import {
  DEFAULT_WEBHOOK_BASE,
  SAMPLE_EVENTS,
  type SampleEvent,
  samplePayload,
  webhookTarget,
} from "../src/server/github/sample-delivery";
import { signGithubPayload } from "../src/server/github/signature";

function isSampleEvent(value: string): value is SampleEvent {
  return SAMPLE_EVENTS.some((event) => event === value);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: "string", default: DEFAULT_WEBHOOK_BASE },
      event: { type: "string", default: "ping" },
      key: { type: "string", default: "STK-1" },
      pr: { type: "string", default: "1" },
    },
    strict: true,
  });
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) throw new Error("GITHUB_WEBHOOK_SECRET is not set (pass it in the shell)");
  if (!isSampleEvent(values.event)) {
    throw new Error(`--event must be one of: ${SAMPLE_EVENTS.join(", ")}`);
  }
  if (!/^[A-Za-z]{2,5}-\d{1,10}$/.test(values.key)) throw new Error("--key must look like STK-1");
  const prNumber = Number(values.pr);
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error("--pr must be a number");

  const target = webhookTarget(values.url);
  const [event, payload] = samplePayload(values.event, values.key.toUpperCase(), prNumber);
  const body = JSON.stringify(payload);
  const delivery = randomUUID();
  const response = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "GitHub-Hookshot/hq-send-test-webhook",
      "x-github-event": event,
      "x-github-delivery": delivery,
      "x-hub-signature-256": signGithubPayload(secret, body),
    },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  process.stdout.write(
    `${event} (${values.event}) delivery ${delivery} → ${target.origin}${target.pathname}: ` +
      `${response.status} ${await response.text()}\n`,
  );
  if (!response.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("send-test-webhook failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
