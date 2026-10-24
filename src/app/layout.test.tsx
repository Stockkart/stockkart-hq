import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The root layout renders the theme class from the `hq_theme` cookie (README "Dark mode"). */

const cookieStore = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "hq_theme" && cookieStore.value !== undefined
        ? { name, value: cookieStore.value }
        : undefined,
  }),
}));

const { default: RootLayout, generateViewport } = await import("./layout");

async function htmlTag(): Promise<string> {
  const markup = renderToStaticMarkup(await RootLayout({ children: <p>page</p> }));
  return markup.slice(0, markup.indexOf(">") + 1);
}

beforeEach(() => {
  cookieStore.value = undefined;
});

describe("root layout theme", () => {
  it("renders the dark class for the cookie dark", async () => {
    cookieStore.value = "dark";
    expect(await htmlTag()).toBe('<html lang="en" class="dark">');
  });

  it("renders theme-system for system, no cookie and unknown values", async () => {
    for (const value of ["system", undefined, "purple"]) {
      cookieStore.value = value;
      expect(await htmlTag()).toBe('<html lang="en" class="theme-system">');
    }
  });

  it("renders no theme class for light", async () => {
    cookieStore.value = "light";
    expect(await htmlTag()).toBe('<html lang="en">');
  });

  it("adds no inline script (S-9: keeps the planned nonce CSP possible)", async () => {
    cookieStore.value = "system";
    const markup = renderToStaticMarkup(await RootLayout({ children: <p>page</p> }));
    expect(markup).not.toContain("<script");
  });

  it("sets theme-color for both schemes, following an explicit choice", async () => {
    const media = ["(prefers-color-scheme: light)", "(prefers-color-scheme: dark)"];
    cookieStore.value = undefined;
    expect((await generateViewport()).themeColor).toEqual([
      { media: media[0], color: "#ffffff" },
      { media: media[1], color: "#0a0a0a" },
    ]);
    cookieStore.value = "dark";
    expect((await generateViewport()).themeColor).toEqual([
      { media: media[0], color: "#0a0a0a" },
      { media: media[1], color: "#0a0a0a" },
    ]);
    cookieStore.value = "light";
    expect((await generateViewport()).themeColor).toEqual([
      { media: media[0], color: "#ffffff" },
      { media: media[1], color: "#ffffff" },
    ]);
  });
});
