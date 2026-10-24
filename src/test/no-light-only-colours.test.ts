import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Dark mode (README "Dark mode"): `bg-white` and `text-black` look right in the light theme
 * only. Use the tokens (`bg-background`, `bg-card`, `text-foreground` …), or put a `dark:`
 * counterpart of the same kind on the same line (`bg-white dark:bg-zinc-900`). This fails on
 * any new one in `src` (outside tests).
 */

const SRC = join(__dirname, "..");
const LIGHT_ONLY = /(?<![\w:-])(bg-white|text-black)(?![\w-])/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Light-only utilities on a line without a `dark:bg-…` / `dark:text-…` counterpart. */
function lightOnlyColours(line: string): string[] {
  return [...line.matchAll(LIGHT_ONLY)].flatMap(([utility]) => {
    const kind = utility.startsWith("bg-") ? "bg" : "text";
    return line.includes(`dark:${kind}-`) ? [] : [utility];
  });
}

describe("no light-only colours", () => {
  it("flags bg-white / text-black without a dark: counterpart", () => {
    expect(lightOnlyColours('className="rounded bg-white p-2"')).toEqual(["bg-white"]);
    expect(lightOnlyColours('className="text-black underline"')).toEqual(["text-black"]);
    expect(lightOnlyColours("@apply bg-white;")).toEqual(["bg-white"]);
    expect(lightOnlyColours('className="bg-white dark:bg-zinc-900"')).toEqual([]);
    expect(lightOnlyColours('className="text-black dark:text-white"')).toEqual([]);
    // Variants of their own, opacity-free lookalikes and tokens are not light-only.
    expect(lightOnlyColours('className="dark:bg-white hover:bg-white/10 bg-background"')).toEqual(
      [],
    );
    expect(lightOnlyColours('className="bg-white-ish text-blackish"')).toEqual([]);
  });

  it("finds none in src (outside tests)", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          lightOnlyColours(line).length > 0
            ? [`${relative(SRC, file)}:${index + 1}: ${line.trim()}`]
            : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
});
