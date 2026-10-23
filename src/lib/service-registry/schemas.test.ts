import { describe, expect, it } from "vitest";

import { createServiceInput, updateServiceInput } from "./schemas";
import { serviceSlug, slugCandidate } from "./slug";

const base = { projectKey: "STK", name: "inventory-api" };

describe("createServiceInput (SVC-1)", () => {
  it("fills defaults and normalises URLs", () => {
    const parsed = createServiceInput.parse({
      ...base,
      repo: "Stockkart/inventory-api",
      environments: [{ name: "production", url: "https://API.example.com", notes: "" }],
      links: [{ label: "Logs", kind: "logs", url: "https://logs.example.com/app" }],
    });
    expect(parsed).toMatchObject({
      name: "inventory-api",
      description: null,
      runtime: null,
      ownerId: null,
      notes: null,
      repo: "Stockkart/inventory-api",
      environments: [{ name: "production", url: "https://api.example.com/" }],
      links: [{ label: "Logs", kind: "logs", url: "https://logs.example.com/app" }],
    });
    expect(parsed.slug).toBeUndefined();
  });

  it.each([
    ["a javascript: link", { links: [{ label: "x", kind: "app", url: "javascript:alert(1)" }] }],
    ["a relative link", { links: [{ label: "x", kind: "app", url: "/admin" }] }],
    [
      "an environment URL with credentials",
      { environments: [{ name: "prod", url: "https://u:p@db.example.com" }] },
    ],
    [
      "a connection string in the notes",
      { notes: ["mongodb+srv://app", ":pw1234@c0.example.net"].join("") },
    ],
    [
      "a token in a link label",
      {
        links: [
          { label: ["AKIA", "ABCDEFGHIJKLMNOP"].join(""), kind: "other", url: "https://a.example" },
        ],
      },
    ],
    ["a bad repo", { repo: "not a repo" }],
    ["a bad slug", { slug: "Bad Slug!" }],
  ])("refuses %s", (_, extra) => {
    expect(createServiceInput.safeParse({ ...base, ...extra }).success).toBe(false);
  });

  it("says why a secret was refused, without repeating it", () => {
    const result = createServiceInput.safeParse({
      ...base,
      notes: "postgres://user:pass@db.example.internal/app",
    });
    expect(result.success).toBe(false);
    const message = result.error?.issues[0]?.message ?? "";
    expect(message).toMatch(/^Notes looks like a connection string/);
    expect(message).toContain("Don't store passwords, tokens or connection strings here.");
    expect(message).not.toContain("pass@");
  });

  it("keeps an explicit slug and lower-cases it", () => {
    expect(
      updateServiceInput.parse({ ...base, serviceId: crypto.randomUUID(), slug: "API" }),
    ).toMatchObject({ slug: "api" });
  });
});

describe("service slugs", () => {
  it("derives a slug from the name", () => {
    expect(serviceSlug("MongoDB Atlas")).toBe("mongodb-atlas");
    expect(serviceSlug("  Café  Orders__API ")).toBe("cafe-orders-api");
    expect(serviceSlug("☁️")).toBe("service");
    expect(serviceSlug("x".repeat(80))).toHaveLength(64);
  });

  it("numbers candidates and keeps them within 64 characters", () => {
    expect(slugCandidate("api", 1)).toBe("api");
    expect(slugCandidate("api", 3)).toBe("api-3");
    const long = slugCandidate("a".repeat(64), 12);
    expect(long).toHaveLength(64);
    expect(long.endsWith("-12")).toBe(true);
  });
});
