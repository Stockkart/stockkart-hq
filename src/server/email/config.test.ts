import { describe, expect, it } from "vitest";

import { isSenderAddress, parseEnv } from "@/env";

import { emailConfigFrom } from "./config";

const valid = {
  DATABASE_URL: "postgres://user:pass@127.0.0.1:5432/db",
  STOCKKART_API_URL: "https://stockkart-api.test",
  AUTH_SECRET: "x".repeat(32),
};
const email = {
  RESEND_API_KEY: "re_abcdefgh_12345678",
  RESEND_FROM_EMAIL: "Stockkart HQ <hq@mail.example.com>",
  APP_BASE_URL: "https://hq.example.com/",
};

describe("NTF-2 email settings (env)", () => {
  it("starts without them, and email is then not configured (fail closed)", () => {
    const env = parseEnv({ ...valid, RESEND_API_KEY: "", CRON_SECRET: "" });
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.CRON_SECRET).toBeUndefined();
    expect(emailConfigFrom(env)).toBeNull();
    // Two of three is still off.
    expect(emailConfigFrom(parseEnv({ ...valid, ...email, APP_BASE_URL: "" }))).toBeNull();
  });

  it("is configured with all three; the base URL becomes an origin", () => {
    expect(emailConfigFrom(parseEnv({ ...valid, ...email }))).toEqual({
      apiKey: "re_abcdefgh_12345678",
      from: "Stockkart HQ <hq@mail.example.com>",
      baseUrl: "https://hq.example.com",
    });
  });

  it.each([
    ["RESEND_API_KEY", "sk_live_123"],
    ["RESEND_FROM_EMAIL", "HQ <hq@mail.example.com>\r\nBcc: x@y.z"],
    ["RESEND_FROM_EMAIL", "not an address"],
    ["APP_BASE_URL", "http://hq.example.com"],
    ["APP_BASE_URL", "https://hq.example.com/app"],
    ["APP_BASE_URL", "https://user:pw@hq.example.com"],
    ["CRON_SECRET", "too-short"],
  ])("rejects %s = %j without echoing it", (name, value) => {
    expect(() => parseEnv({ ...valid, ...email, [name]: value })).toThrow(name);
    try {
      parseEnv({ ...valid, ...email, [name]: value });
    } catch (error) {
      expect(String(error)).not.toContain(value);
    }
  });

  it("allows http only for a loopback base URL", () => {
    expect(
      parseEnv({ ...valid, ...email, APP_BASE_URL: "http://127.0.0.1:3001" }).APP_BASE_URL,
    ).toBe("http://127.0.0.1:3001");
  });

  it("accepts plain and named senders", () => {
    expect(isSenderAddress("hq@mail.example.com")).toBe(true);
    expect(isSenderAddress("Stockkart HQ <hq@mail.example.com>")).toBe(true);
    expect(isSenderAddress('"HQ" <hq@mail.example.com>')).toBe(false);
  });
});
