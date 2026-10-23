import { z } from "zod";

import { DEFAULT_HANDBOOK_REPO, isHandbookRepo } from "./lib/handbook/constants";
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

/**
 * A sender for the `from` field: `address` or `Name <address>`. No line breaks, quotes or
 * angle brackets in the name, so the value can never inject an email header.
 */
export function isSenderAddress(value: string): boolean {
  const address = "[^\\s<>@\"',;]+@[^\\s<>@\"',;]+\\.[A-Za-z]{2,}";
  return new RegExp(`^(?:${address}|[^<>\\r\\n"]{1,100} <${address}>)$`).test(value);
}

/** An origin for links in emails: https (http only for loopback), no path, query or hash. */
export function isPublicOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const secure =
    url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
  return secure && url.pathname === "/" && !url.search && !url.hash && !url.username;
}

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
  // Cloudflare R2 (attachments, diagram thumbnails; the backup workflow uses GitHub secrets).
  // All optional: without the full set, `storageConfigured()` is false and every storage
  // call throws `StorageNotConfigured` (fail closed). Formats are checked only when set.
  R2_ACCOUNT_ID: optionalString.pipe(
    z
      .string()
      .regex(/^[0-9a-f]{32}$/, "R2_ACCOUNT_ID must be the 32-character Cloudflare account id")
      .optional(),
  ),
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET: optionalString.pipe(
    z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/,
        "R2_BUCKET must be 3–63 lowercase letters, digits or hyphens",
      )
      .optional(),
  ),
  // GH-1 webhook HMAC secret (`openssl rand -hex 32`). Optional so the app starts without
  // it, but the webhook then FAILS CLOSED: it answers 503 and accepts nothing.
  GITHUB_WEBHOOK_SECRET: optionalString,
  // NTF-2 email digest via Resend. All three optional: until every one is set no email is
  // ever sent (fail closed) and the profile says "Email isn't set up". Formats are checked
  // only when set.
  RESEND_API_KEY: optionalString.pipe(
    z
      .string()
      .regex(/^re_[A-Za-z0-9_-]{8,200}$/, "RESEND_API_KEY must be a Resend API key (re_…)")
      .optional(),
  ),
  // `HQ <hq@mail.example.com>` or `hq@mail.example.com`, on a domain verified in Resend.
  RESEND_FROM_EMAIL: optionalString.pipe(
    z
      .string()
      .refine(isSenderAddress, "RESEND_FROM_EMAIL must be an address or `Name <address>`")
      .optional(),
  ),
  // The public URL of HQ (origin only), used for the links in emails. https only (http is
  // allowed for localhost).
  APP_BASE_URL: optionalString.pipe(
    z
      .url()
      .refine(
        isPublicOrigin,
        "APP_BASE_URL must be an https origin (no path), e.g. https://hq.example.com",
      )
      .transform((value) => new URL(value).origin)
      .optional(),
  ),
  // NTF-2 digest job: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`
  // (`openssl rand -hex 32`). Optional, but /api/cron/digest and /api/cron/monthly (COST-7)
  // then answer 503 (fail closed).
  CRON_SECRET: optionalString.pipe(
    z.string().min(32, "CRON_SECRET must be at least 32 characters").optional(),
  ),
  // DOC-14 handbook sync through a GitHub App (README "Engineering handbook sync"). All
  // optional: until the App id, installation id and key are all set, `handbookConfigured()`
  // is false and every handbook write fails closed ("Handbook sync isn't set up"). The repo
  // must belong to the Stockkart org; it is the ONLY repo the App client can address.
  HANDBOOK_REPO: optionalString.pipe(
    z
      .string()
      .refine(isHandbookRepo, "HANDBOOK_REPO must be Owner/repo in the Stockkart organisation")
      .default(DEFAULT_HANDBOOK_REPO),
  ),
  GITHUB_APP_ID: optionalString.pipe(
    z
      .string()
      .regex(/^[1-9][0-9]{0,19}$/, "GITHUB_APP_ID must be the numeric App ID")
      .optional(),
  ),
  GITHUB_APP_INSTALLATION_ID: optionalString.pipe(
    z
      .string()
      .regex(/^[1-9][0-9]{0,19}$/, "GITHUB_APP_INSTALLATION_ID must be the numeric installation id")
      .optional(),
  ),
  // PEM, as GitHub downloads it. Vercel and .env files often hold it on one line with
  // literal `\n` escapes; those become real newlines. Never printed (see parseEnv).
  GITHUB_APP_PRIVATE_KEY: optionalString.pipe(
    z
      .string()
      .transform((value) => value.replace(/\\n/g, "\n").trim())
      .refine(
        (value) =>
          /^-----BEGIN (?:RSA )?PRIVATE KEY-----\n[\s\S]+\n-----END (?:RSA )?PRIVATE KEY-----$/.test(
            value,
          ),
        "GITHUB_APP_PRIVATE_KEY must be the App's PEM private key",
      )
      .optional(),
  ),
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
