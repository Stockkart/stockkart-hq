import { expect, test } from "@playwright/test";

test("an anonymous visit to / ends at /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in to Stockkart HQ" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("an anonymous visit to /my-work ends at /login", async ({ page }) => {
  await page.goto("/my-work");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fmy-work$/);
});

test("anonymous API requests get 401, and security headers are set", async ({ request }) => {
  const api = await request.get("/api/files/x", { maxRedirects: 0 });
  expect(api.status()).toBe(401);

  const login = await request.get("/login");
  const headers = login.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
});
