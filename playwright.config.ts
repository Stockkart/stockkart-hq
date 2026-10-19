import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// NextRequest normalises 127.0.0.1 to "localhost" in redirects, so browse via localhost.
// The server itself still binds to the loopback address only.
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Smoke tests against a production build (`pnpm build` first).
 *
 * They only exercise anonymous behaviour, which never touches the database or
 * inventory-api, so dummy env values are enough and CI runs them without secrets.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `next start --hostname 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://e2e:e2e@127.0.0.1:5432/e2e",
      STOCKKART_API_URL: process.env.STOCKKART_API_URL ?? "https://stockkart-api.invalid",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-dummy-secret-not-used-anywhere-real-00",
      AUTH_URL: BASE_URL,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
