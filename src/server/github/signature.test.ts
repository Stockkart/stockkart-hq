import { describe, expect, it } from "vitest";

import { signGithubPayload, verifyGithubSignature } from "./signature";

const SECRET = "test-webhook-secret";
const body = new TextEncoder().encode('{"zen":"Keep it logically awesome."}');

describe("verifyGithubSignature (S-4)", () => {
  it("accepts the HMAC-SHA256 of the raw body", () => {
    expect(verifyGithubSignature(SECRET, body, signGithubPayload(SECRET, body))).toBe(true);
  });

  it("matches GitHub's documented example", () => {
    // docs.github.com "Validating webhook deliveries": secret "It's a Secret to Everybody",
    // payload "Hello, World!".
    expect(
      verifyGithubSignature(
        "It's a Secret to Everybody",
        new TextEncoder().encode("Hello, World!"),
        "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
      ),
    ).toBe(true);
  });

  it("rejects another secret, a changed body and a flipped digit", () => {
    const good = signGithubPayload(SECRET, body);
    expect(verifyGithubSignature("other-secret", body, good)).toBe(false);
    expect(verifyGithubSignature(SECRET, new TextEncoder().encode("{}"), good)).toBe(false);
    const flipped = `${good.slice(0, -1)}${good.endsWith("0") ? "1" : "0"}`;
    expect(verifyGithubSignature(SECRET, body, flipped)).toBe(false);
  });

  it("rejects a missing or empty header and an empty secret", () => {
    expect(verifyGithubSignature(SECRET, body, null)).toBe(false);
    expect(verifyGithubSignature(SECRET, body, "")).toBe(false);
    expect(verifyGithubSignature("", body, signGithubPayload("", body))).toBe(false);
  });

  it("rejects the wrong length or format without throwing", () => {
    const good = signGithubPayload(SECRET, body);
    expect(verifyGithubSignature(SECRET, body, good.slice(0, -2))).toBe(false);
    expect(verifyGithubSignature(SECRET, body, `${good}00`)).toBe(false);
    expect(verifyGithubSignature(SECRET, body, good.slice(0, -1))).toBe(false);
    expect(verifyGithubSignature(SECRET, body, "sha256=")).toBe(false);
    expect(verifyGithubSignature(SECRET, body, good.replace("sha256=", "sha1="))).toBe(false);
    expect(verifyGithubSignature(SECRET, body, good.replace("sha256=", ""))).toBe(false);
    expect(verifyGithubSignature(SECRET, body, "sha256=zz")).toBe(false);
  });
});
