import { describe, expect, it, vi } from "vitest";

import { createResendSender, type EmailMessage, RESEND_ENDPOINT } from "./resend";

const message: EmailMessage = {
  from: "HQ <hq@mail.example.test>",
  to: "person@example.test",
  subject: "Stockkart HQ: 2 unread notifications",
  text: "plain",
  html: "<p>html</p>",
  headers: { "List-Unsubscribe": "<https://hq.example.test/unsubscribe?token=t>" },
  idempotencyKey: "digest-1-2",
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function sender(...responses: (Response | Error)[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    if (next instanceof Error) throw next;
    return next;
  });
  return { send: createResendSender({ apiKey: "re_test_key_123", fetch: fetchMock }), fetchMock };
}

describe("Resend sender (NTF-2)", () => {
  it("POSTs the email with the key, a User-Agent and the idempotency key", async () => {
    const { send, fetchMock } = sender(reply(200, { id: "msg_123" }));
    expect(await send(message)).toEqual({ ok: true, providerId: "msg_123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer re_test_key_123",
      "Idempotency-Key": "digest-1-2",
      "User-Agent": "stockkart-hq",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      from: message.from,
      to: [message.to],
      subject: message.subject,
      text: "plain",
      html: "<p>html</p>",
      headers: message.headers,
    });
  });

  it("retries once on a 5xx, with the same idempotency key", async () => {
    const { send, fetchMock } = sender(
      reply(503, { name: "service_unavailable", message: "x" }),
      reply(200, { id: "msg_2" }),
    );
    expect(await send(message)).toEqual({ ok: true, providerId: "msg_2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = fetchMock.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("idempotency-key"),
    );
    expect(keys).toEqual(["digest-1-2", "digest-1-2"]);
  });

  it("fails after a second 5xx, and on a timeout or network error twice", async () => {
    expect(await sender(reply(500, {}), reply(502, "bad")).send(message)).toEqual({
      ok: false,
      errorCode: "http_502",
    });
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    expect(await sender(timeout, timeout).send(message)).toEqual({
      ok: false,
      errorCode: "timeout",
    });
    expect(
      await sender(new TypeError("fetch failed"), reply(200, { id: "m" })).send(message),
    ).toEqual({ ok: true, providerId: "m" });
  });

  it("does not retry a 4xx, and reports only the provider's error name", async () => {
    const { send, fetchMock } = sender(
      reply(403, { name: "validation_error", message: "person@example.test is not allowed" }),
    );
    const result = await send(message);
    expect(result).toEqual({ ok: false, errorCode: "validation_error" });
    expect(JSON.stringify(result)).not.toContain("person@example.test");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await sender(reply(429, { name: "Rate Limit!" })).send(message)).toEqual({
      ok: false,
      errorCode: "http_429",
    });
  });

  it("treats a 2xx without an id as a failure", async () => {
    expect(await sender(reply(200, { nope: true })).send(message)).toEqual({
      ok: false,
      errorCode: "invalid_response",
    });
  });
});
