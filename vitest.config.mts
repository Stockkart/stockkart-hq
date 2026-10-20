import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // Migrates a throwaway template database when HQ_DB_TESTS=1; a no-op otherwise.
    globalSetup: ["./src/test/db-global-setup.ts"],
    restoreMocks: true,
    unstubGlobals: true,
    // next-auth imports "next/server" without a file extension, which Node's ESM resolver
    // rejects; inlining lets Vite resolve it the way the Next.js bundler does.
    server: { deps: { inline: ["next-auth"] } },
    // Dummy, non-secret values so modules that validate env at import time can load.
    // No test talks to a real database or inventory-api; fetch is always mocked. DB-backed
    // tests (HQ_DB_TESTS=1) use their own throwaway loopback Postgres (src/test/db-config.ts).
    env: {
      DATABASE_URL: "postgres://test:test@127.0.0.1:5432/hq_test",
      STOCKKART_API_URL: "https://stockkart-api.test",
      AUTH_SECRET: "test-only-secret-not-used-anywhere-real-000000",
    },
  },
});
