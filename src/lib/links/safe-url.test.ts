import { describe, expect, it } from "vitest";

import { isSafeUrl, parseSafeUrl, SAFE_URL_MAX, safeUrlSchema } from "./safe-url";

describe("parseSafeUrl", () => {
  it.each([
    ["https://cloud.digitalocean.com/apps/abc", "https://cloud.digitalocean.com/apps/abc"],
    ["http://localhost:3000/health", "http://localhost:3000/health"],
    ["HTTPS://Example.COM", "https://example.com/"],
    [
      "https://grafana.example.test/d/x?orgId=1#panel",
      "https://grafana.example.test/d/x?orgId=1#panel",
    ],
  ])("accepts %s", (input, expected) => {
    expect(parseSafeUrl(input)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "mailto:ops@example.test",
    "ftp://files.example.test",
    "file:///etc/passwd",
    "/relative/path",
    "//example.test/protocol-relative",
    "example.test",
    "https://user:secret@example.test/",
    "https://user@example.test/",
    "https://:secret@example.test/",
    " https://example.test",
    "https://exa mple.test",
    "https://example.test/\n",
    "java\tscript:alert(1)",
    "https://example.test/\u200b",
    "https://exa\u202emple.test",
    "https://example.test/\u0085",
    "",
  ])("refuses %j", (input) => {
    expect(parseSafeUrl(input)).toBeNull();
    expect(isSafeUrl(input)).toBe(false);
  });

  it("refuses non-strings and over-long URLs", () => {
    expect(parseSafeUrl(undefined)).toBeNull();
    expect(parseSafeUrl(42)).toBeNull();
    expect(parseSafeUrl(`https://example.test/${"a".repeat(SAFE_URL_MAX)}`)).toBeNull();
  });
});

describe("safeUrlSchema", () => {
  it("trims and normalises a good URL", () => {
    expect(safeUrlSchema.parse("  https://Example.test/logs  ")).toBe("https://example.test/logs");
  });

  it("rejects an unsafe URL with a message", () => {
    const result = safeUrlSchema.safeParse("https://admin:hunter2@db.example.test");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/without a username or password/);
  });
});
