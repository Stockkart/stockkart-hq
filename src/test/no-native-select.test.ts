import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The app uses its own pickers (`components/ui/select.tsx`, `combobox.tsx`): native select
 * elements (and their option lists and datalists) look and behave differently per browser
 * and cannot show icons, avatars or search. This fails on any that creeps back into `src`.
 */

const SRC = join(__dirname, "..");
const NATIVE = /<(select|datalist)\b|\bNativeSelect\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("no native select elements", () => {
  it("finds none in src (outside tests)", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          NATIVE.test(line) ? [`${relative(SRC, file)}:${index + 1}: ${line.trim()}`] : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
});
