import { describe, expect, it } from "vitest";

import { findSecretInText, findSecretInUrl, shannonEntropy } from "./secrets";

/**
 * SVC-1 "No secrets". The sample "secrets" below are synthetic: random-looking strings
 * built at run time in the shape of real tokens, never real credentials.
 */
const fake = (prefix: string, length: number, alphabet = "aB3dE5fG7hJ9kL2mN4pQ6rS8tU0vW1xY") =>
  prefix + Array.from({ length }, (_, i) => alphabet[(i * 7 + 3) % alphabet.length]).join("");

describe("findSecretInText (true positives)", () => {
  it.each([
    [
      "mongodb+srv connection string",
      ["mongodb+srv://app", ":hunter22@cluster0.example.net/db"].join(""),
    ],
    ["postgres connection string", "postgres://user:pass@db.example.internal:5432/app"],
    ["postgresql with empty-looking host", "use postgresql://admin:x@10.0.0.4/app for repairs"],
    ["redis URL", "redis://default:s3cr3t@cache.example.net:6379"],
    ["GitHub classic token", `token is ${fake("ghp_", 36)}`],
    ["GitHub fine-grained token", fake("github_pat_", 40)],
    ["OpenAI-style key", fake("sk-", 40)],
    ["Stripe live key", fake("sk_live_", 24)],
    ["AWS access key id", ["AKIA", "ABCDEFGHIJKLMNOP"].join("")],
    ["Slack bot token", `xoxb-${fake("", 24, "0123456789")}`],
    ["Slack user token", `xoxp-${fake("", 24, "0123456789")}`],
    [
      "private key",
      ["-----BEGIN OPENSSH ", "PRIVATE KEY-----\nabc\n-----END OPENSSH ", "PRIVATE KEY-----"].join(
        "",
      ),
    ],
    ["password assignment", "password: correct-horse-battery"],
    ["api key assignment", "API_KEY=abcdef123456"],
    ["32+ hex characters", ["key 9f86d081884c7d65", "9a2feaa0c55ad015a3bf4f1b"].join("")],
    ["long base64", fake("", 44, ["Zx8Qw2Er4Ty6Ui0OpAs1", "Df3Gh5Jk7Lz9Xc+Vb/Nm"].join(""))],
  ])("refuses a %s", (_, value) => {
    expect(findSecretInText(value)).not.toBeNull();
  });
});

describe("findSecretInText (no false positives)", () => {
  it.each([
    ["a plain note", "Deploys from main. Ask Ada before restarting the worker."],
    ["a runtime", "DigitalOcean App Platform"],
    ["a repo", "Stockkart/inventory-api"],
    ["a URL without credentials", "Dashboards: https://grafana.example.com/d/abc123/api"],
    ["a mongodb URL without credentials", "mongodb+srv://cluster0.example.net (creds in DO env)"],
    ["a UUID", "App id 1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed"],
    ["a short commit SHA", "Pinned to 9f86d081884c"],
    ["a long word", "InventoryPlatformServiceControllerFactory"],
    ["a kebab slug", "inventory-platform-production-cluster-01-primary"],
    ["words ending in sk", "Ask the desk-top team; risk-assessment is in the runbook."],
    ["the word password without a value", "Password lives in the DigitalOcean env settings."],
  ])("accepts %s", (_, value) => {
    expect(findSecretInText(value)).toBeNull();
  });
});

describe("findSecretInUrl", () => {
  it.each([
    "https://example.com/api",
    "https://cloud.digitalocean.com/apps/1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed/overview",
    [
      "https://github.com/Stockkart/inventory-api/commit/9f86d081884c7d65",
      "9a2feaa0c55ad015a3bf4f1b",
    ].join(""),
    "https://cloud.mongodb.com/v2/5f1e2d3c4b5a69788796a5b4#/clusters",
    "https://console.neon.tech/app/projects/shy-forest-123456?branchId=br-cool-sun-1",
    "http://localhost:3000/health",
  ])("accepts a normal URL: %s", (url) => {
    expect(findSecretInUrl(url)).toBeNull();
  });

  it.each([
    ["credentials", "https://admin:hunter22@db.example.com/console"],
    ["a token parameter", "https://logs.example.com/view?token=abcdef"],
    ["an api key parameter", "https://maps.example.com/?api_key=xyz123"],
    ["a presigned URL", "https://bucket.example.com/f?X-Amz-Signature=abc&X-Amz-Credential=a"],
    ["a token prefix in the path", `https://example.com/${fake("ghp_", 36)}`],
    ["a Slack webhook", "https://hooks.slack.com/services/T0000/B0000/abcdefghijkl"],
    ["random query value", `https://example.com/?x=${fake("", 40)}`],
  ])("refuses a URL with %s", (_, url) => {
    expect(findSecretInUrl(url)).not.toBeNull();
  });

  it("never echoes the value in its message", () => {
    const secret = "postgres://user:pass@db.example.internal/app";
    expect(findSecretInUrl(secret)?.message).not.toContain("pass@");
  });
});

describe("shannonEntropy", () => {
  it("is 0 for one repeated character and higher for varied text", () => {
    expect(shannonEntropy("aaaa")).toBe(0);
    expect(shannonEntropy("abcd")).toBe(2);
  });
});
