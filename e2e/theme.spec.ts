import { expect, type Page, test } from "@playwright/test";

/**
 * Dark mode on the (anonymous) login page against the production build (README "Dark
 * mode"): the server renders the theme class from the `hq_theme` cookie, and the CSS
 * switches the tokens and `color-scheme`, with no inline script. Screenshots of each theme go
 * to `test-results/` (the login page shows no data).
 */

/** The sign-in card's background as sRGB (browsers report oklch tokens as `lab(…)`). */
async function cardBackground(page: Page): Promise<number[]> {
  return page.getByRole("heading", { name: "Sign in to Stockkart HQ" }).evaluate((heading) => {
    const color = getComputedStyle(heading.closest(".bg-card") ?? heading).backgroundColor;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) throw new Error("no canvas");
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  });
}

const colorScheme = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

for (const { name, cookie, scheme, htmlClass, dark } of [
  { name: "light", cookie: "light", scheme: "dark", htmlClass: null, dark: false },
  { name: "dark", cookie: "dark", scheme: "light", htmlClass: "dark", dark: true },
  { name: "system-light", cookie: null, scheme: "light", htmlClass: "theme-system", dark: false },
  { name: "system-dark", cookie: "system", scheme: "dark", htmlClass: "theme-system", dark: true },
] as const) {
  test(`login page renders the ${name} theme`, async ({ page, context, baseURL }, testInfo) => {
    if (cookie) await context.addCookies([{ name: "hq_theme", value: cookie, url: baseURL }]);
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in to Stockkart HQ" })).toBeVisible();
    if (htmlClass) await expect(page.locator("html")).toHaveAttribute("class", htmlClass);
    else expect(await page.locator("html").getAttribute("class")).toBeNull();
    // --card: white in light, oklch(0.205 0 0) ≈ rgb(23, 23, 23) in dark.
    expect(await cardBackground(page)).toEqual(dark ? [23, 23, 23] : [255, 255, 255]);
    expect(await colorScheme(page)).toBe(dark ? "dark" : "light");
    // No inline script was added for the theme (S-9: the planned nonce CSP stays possible).
    const html = await (await page.request.get("/login")).text();
    expect(html).not.toContain("hq_theme");
    await page.screenshot({ path: testInfo.outputPath(`login-${name}.png`), fullPage: true });
  });
}
