import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

/**
 * Compiles the real globals.css with Tailwind (as `next build` does) and checks that the
 * dark tokens and `dark:` utilities switch together for both the `dark` class and the
 * `theme-system` class under `prefers-color-scheme: dark` (README "Dark mode").
 */

const MODULES = join(__dirname, "../../node_modules");

async function compiledCss(candidates: string[]): Promise<string> {
  const css = readFileSync(join(__dirname, "globals.css"), "utf8");
  const compiler = await compile(css, {
    base: __dirname,
    async loadStylesheet(id: string, base: string) {
      const path =
        id === "tailwindcss"
          ? join(MODULES, "tailwindcss/index.css")
          : id === "tw-animate-css"
            ? join(MODULES, "tw-animate-css/dist/tw-animate.css")
            : join(base, id);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  return compiler.build(candidates);
}

/** Collapses whitespace so assertions do not depend on the printer's formatting. */
const flat = (css: string) => css.replace(/\s+/g, " ");

describe("theme CSS", () => {
  it("applies the dark tokens and color-scheme for .dark and, under the media query, .theme-system", async () => {
    const css = flat(await compiledCss([]));
    expect(css).toMatch(/:root \{ color-scheme: light;/);
    expect(css).toMatch(
      /:root:is\(\.dark, \.dark \*\) \{ color-scheme: dark; --background: oklch\(0\.145 0 0\);/,
    );
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{ :root:is\(\.theme-system, \.theme-system \*\) \{ color-scheme: dark; --background: oklch\(0\.145 0 0\);/,
    );
    // The system block is never applied outside the media query.
    const outsideMedia = css.replace(/@media \(prefers-color-scheme: dark\) \{[^@]*\}/g, "");
    expect(outsideMedia).not.toContain(".theme-system");
  });

  it("makes dark: utilities follow both the dark class and the system preference", async () => {
    const css = flat(await compiledCss(["dark:bg-red-950", "bg-background"]));
    expect(css).toContain(
      ".dark\\:bg-red-950:is(.dark, .dark *) { background-color: var(--color-red-950); }",
    );
    expect(css).toContain(
      "@media (prefers-color-scheme: dark) { .dark\\:bg-red-950:is(.theme-system, .theme-system *) { background-color: var(--color-red-950); } }",
    );
    expect(css).toContain(".bg-background { background-color: var(--background); }");
  });
});
