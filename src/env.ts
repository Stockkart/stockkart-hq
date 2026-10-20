import { z } from "zod";

import { databaseUrlUsesTls, LOOPBACK_HOSTS } from "./server/db/database-url";

/**
 * Server-side environment, validated once at module load.
 *
 * Fail fast / fail closed: if a required variable is missing or malformed, importing this
 * module throws, so `next dev`, `next build`, `next start` (via next.config.ts and
 * instrumentation.ts) and every serverless function cold start refuse to run. In particular,
 * without STOCKKART_API_URL or AUTH_SECRET nobody can sign in.
 *
 * Never import this from client components: it holds secrets.
 */

const stockkartApiUrl = z
  .url()
  .transform((value) => value.replace(/\/+$/, ""))
  .refine((value) => !/\/api\/v1$/i.test(value), {
    message: "STOCKKART_API_URL must be the base URL without the /api/v1 suffix",
  })
  .refine(
    (value) => {
      const url = new URL(value);
      // Bearer tokens travel to this host, so plain http is only allowed for local development.
      return url.protocol === "https:" || LOOPBACK_HOSTS.has(url.hostname);
    },
    { message: "STOCKKART_API_URL must use https (http is allowed only for localhost)" },
  );

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === "" ? undefined : value));

export const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      message: "DATABASE_URL must be a postgres:// or postgresql:// connection string",
    })
    .refine(databaseUrlUsesTls, {
      // The connection carries every query and row, so it must be encrypted. A loopback
      // Postgres (unit tests, CI dummy values, local development) is exempt.
      message: "DATABASE_URL must set sslmode=require (only localhost may omit it)",
    }),
  STOCKKART_API_URL: stockkartApiUrl,
  // Auth.js encrypts the session JWT with a key derived from this. 32+ random bytes,
  // base64-encoded (`openssl rand -base64 32`) is ~44 characters.
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  // Optional: Auth.js infers the URL on Vercel. Set it when self-hosting behind a proxy.
  AUTH_URL: z
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // Later phases (attachments, backups). Optional for now.
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET: optionalString,
  // GH-1 webhook HMAC secret (`openssl rand -hex 32`). Optional so the app starts without
  // it, but the webhook then FAILS CLOSED: it answers 503 and accepts nothing.
  GITHUB_WEBHOOK_SECRET: optionalString,
  // Development aid: `1` logs database round trips per request (counts and timings only,
  // never SQL text or parameters). Off unless set to exactly "1".
  HQ_LOG_QUERIES: z
    .string()
    .optional()
    .transform((value) => value === "1"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Only variable names and messages are printed, never values.
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid or missing environment variables:\n${problems}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
