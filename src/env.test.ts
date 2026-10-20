import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://user:pass@127.0.0.1:5432/db",
  STOCKKART_API_URL: "https://stockkart-api.test",
  AUTH_SECRET: "x".repeat(32),
};

describe("env validation (fail fast, fail closed)", () => {
  it("accepts a complete configuration and strips a trailing slash", () => {
    expect(parseEnv({ ...valid, STOCKKART_API_URL: "https://stockkart-api.test/" })).toMatchObject({
      STOCKKART_API_URL: "https://stockkart-api.test",
    });
  });

  it.each(["DATABASE_URL", "STOCKKART_API_URL", "AUTH_SECRET"] as const)(
    "refuses to start without %s",
    (name) => {
      const source: Record<string, string | undefined> = { ...valid, [name]: undefined };
      expect(() => parseEnv(source)).toThrow(name);
    },
  );

  it("rejects a short AUTH_SECRET", () => {
    expect(() => parseEnv({ ...valid, AUTH_SECRET: "too-short" })).toThrow("AUTH_SECRET");
  });

  it("rejects STOCKKART_API_URL with the /api/v1 suffix", () => {
    expect(() => parseEnv({ ...valid, STOCKKART_API_URL: "https://x.test/api/v1" })).toThrow(
      "without the /api/v1 suffix",
    );
  });

  it("rejects plain http except for localhost", () => {
    expect(() => parseEnv({ ...valid, STOCKKART_API_URL: "http://api.example.test" })).toThrow(
      "https",
    );
    expect(
      parseEnv({ ...valid, STOCKKART_API_URL: "http://localhost:8080" }).STOCKKART_API_URL,
    ).toBe("http://localhost:8080");
  });

  it("starts without GITHUB_WEBHOOK_SECRET (the webhook then fails closed)", () => {
    expect(parseEnv(valid).GITHUB_WEBHOOK_SECRET).toBeUndefined();
    expect(parseEnv({ ...valid, GITHUB_WEBHOOK_SECRET: "" }).GITHUB_WEBHOOK_SECRET).toBeUndefined();
    expect(parseEnv({ ...valid, GITHUB_WEBHOOK_SECRET: "s3cret" }).GITHUB_WEBHOOK_SECRET).toBe(
      "s3cret",
    );
  });

  it("keeps the query log off unless HQ_LOG_QUERIES is exactly 1", () => {
    expect(parseEnv(valid).HQ_LOG_QUERIES).toBe(false);
    expect(parseEnv({ ...valid, HQ_LOG_QUERIES: "0" }).HQ_LOG_QUERIES).toBe(false);
    expect(parseEnv({ ...valid, HQ_LOG_QUERIES: "true" }).HQ_LOG_QUERIES).toBe(false);
    expect(parseEnv({ ...valid, HQ_LOG_QUERIES: "1" }).HQ_LOG_QUERIES).toBe(true);
  });

  it("never echoes secret values in the error", () => {
    const secret = "short-secret-value";
    expect(() => parseEnv({ ...valid, AUTH_SECRET: secret })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) }),
    );
  });

  describe("DATABASE_URL TLS", () => {
    const remote = "postgresql://user:pass@ep-x.eu-central-1.aws.neon.tech/db";

    it.each([`${remote}?sslmode=require`, `${remote}?sslmode=verify-full&channel_binding=require`])(
      "accepts a remote URL with TLS required: %s",
      (url) => {
        expect(parseEnv({ ...valid, DATABASE_URL: url }).DATABASE_URL).toBe(url);
      },
    );

    it.each([remote, `${remote}?sslmode=prefer`, `${remote}?sslmode=disable`])(
      "rejects a remote URL without sslmode=require: %s",
      (url) => {
        expect(() => parseEnv({ ...valid, DATABASE_URL: url })).toThrow("sslmode=require");
      },
    );

    it.each([
      "postgres://test:test@127.0.0.1:5432/hq_test",
      "postgres://ci:ci@localhost:5432/ci",
      "postgres://u:p@[::1]:5432/db",
    ])("allows a loopback Postgres without sslmode (tests, CI): %s", (url) => {
      expect(parseEnv({ ...valid, DATABASE_URL: url }).DATABASE_URL).toBe(url);
    });

    it("does not echo the connection string in the error", () => {
      expect(() => parseEnv({ ...valid, DATABASE_URL: remote })).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining("pass@") }),
      );
    });
  });
});
