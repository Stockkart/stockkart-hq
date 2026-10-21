import { describe, expect, it } from "vitest";

import { createPayload, pullRequestPayload, pushPayload } from "./payloads";
import { SAMPLE_EVENTS, samplePayload, webhookTarget } from "./sample-delivery";

describe("send-test-webhook helpers", () => {
  it.each(["http://127.0.0.1:3000", "http://localhost:3001/", "https://hq.example.test"])(
    "accepts %s",
    (base) => {
      expect(webhookTarget(base).pathname).toBe("/api/webhooks/github");
    },
  );

  it.each([
    "http://hq.example.test",
    "http://10.0.0.5:3000",
    "http://0.0.0.0:3000",
    "ftp://127.0.0.1",
    "https://user:pass@hq.example.test",
    "not a url",
  ])("refuses %s", (base) => {
    expect(() => webhookTarget(base)).toThrow();
  });

  it("builds payloads the webhook accepts", () => {
    const schemaFor = (event: string) =>
      ({ create: createPayload, push: pushPayload, pull_request: pullRequestPayload })[event] ??
      null;
    for (const sample of SAMPLE_EVENTS) {
      const [event, payload] = samplePayload(sample, "STK-1");
      const schema = schemaFor(event);
      if (event !== "ping") expect(schema?.safeParse(payload).success).toBe(true);
    }
  });
});
