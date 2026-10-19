import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Every direct dependency is pinned to an exact version (SPEC §7.1: "Pin exact versions").
 * `.npmrc` sets `save-exact=true`; this test catches a range added by hand.
 */
const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as Record<string, unknown>;

const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function entries(field: string): [string, string][] {
  const value = packageJson[field];
  if (value === undefined) return [];
  return Object.entries(value as Record<string, string>);
}

describe("package.json dependency pins", () => {
  const all = [...entries("dependencies"), ...entries("devDependencies")];

  it("declares dependencies", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it.each(all)("pins %s to an exact version", (_name, version) => {
    expect(version).toMatch(EXACT_VERSION);
  });
});
