import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` works offline and needs no database URL.
// `drizzle-kit migrate` reads DATABASE_URL from the shell environment (never commit it).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
