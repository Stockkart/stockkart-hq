import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://user:pass@127.0.0.1:5432/db",
  STOCKKART_API_URL: "https://stockkart-api.test",
  AUTH_SECRET: "x".repeat(32),
};
/** Not a real key: only the PEM shape is checked at startup. */
const PEM_ONE_LINE =
  "-----BEGIN RSA PRIVATE KEY-----\\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\\n-----END RSA PRIVATE KEY-----";

describe("handbook sync env (DOC-14)", () => {
  it("starts without any App setting and defaults the repo", () => {
    const env = parseEnv(valid);
    expect(env.HANDBOOK_REPO).toBe("Stockkart/engineering-handbook");
    expect(env.GITHUB_APP_ID).toBeUndefined();
    expect(env.GITHUB_APP_INSTALLATION_ID).toBeUndefined();
    expect(env.GITHUB_APP_PRIVATE_KEY).toBeUndefined();
    expect(parseEnv({ ...valid, HANDBOOK_REPO: "" }).HANDBOOK_REPO).toBe(
      "Stockkart/engineering-handbook",
    );
  });

  it("only accepts a repo of the Stockkart org", () => {
    expect(parseEnv({ ...valid, HANDBOOK_REPO: "stockkart/handbook" }).HANDBOOK_REPO).toBe(
      "stockkart/handbook",
    );
    for (const repo of [
      "evil/engineering-handbook",
      "Stockkart",
      "Stockkart/a/b",
      "Stockkart/..",
    ]) {
      expect(() => parseEnv({ ...valid, HANDBOOK_REPO: repo })).toThrow("HANDBOOK_REPO");
    }
  });

  it("turns literal \\n escapes of the key into newlines and never echoes it", () => {
    const env = parseEnv({ ...valid, GITHUB_APP_PRIVATE_KEY: PEM_ONE_LINE });
    expect(env.GITHUB_APP_PRIVATE_KEY?.split("\n")).toHaveLength(3);
    let message = "";
    try {
      parseEnv({ ...valid, GITHUB_APP_PRIVATE_KEY: "not a key MIIBOgIBAAJB" });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("GITHUB_APP_PRIVATE_KEY");
    expect(message).not.toContain("MIIBOgIBAAJB");
  });

  it("checks the ids are numeric", () => {
    expect(() => parseEnv({ ...valid, GITHUB_APP_ID: "abc" })).toThrow("GITHUB_APP_ID");
    expect(() => parseEnv({ ...valid, GITHUB_APP_INSTALLATION_ID: "1; x" })).toThrow(
      "GITHUB_APP_INSTALLATION_ID",
    );
    expect(
      parseEnv({ ...valid, GITHUB_APP_ID: "123", GITHUB_APP_INSTALLATION_ID: "456" }),
    ).toMatchObject({ GITHUB_APP_ID: "123", GITHUB_APP_INSTALLATION_ID: "456" });
  });
});
