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

  it("never echoes secret values in the error", () => {
    const secret = "short-secret-value";
    expect(() => parseEnv({ ...valid, AUTH_SECRET: secret })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) }),
    );
  });
});
