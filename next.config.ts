import type { NextConfig } from "next";

// Validate the environment as soon as `next dev` / `next build` / `next start` loads its
// config: a missing or malformed variable stops the process with a list of names (S-6).
import { env } from "./src/env";

const isDev = process.env.NODE_ENV === "development";

/**
 * The private R2 bucket's origin (S-5), only when storage is configured. Attachments and
 * thumbnails are `<img>`s of `/api/files/…`, which redirect to a presigned URL there, and
 * uploads PUT to a presigned URL there, so img-src and connect-src need this one origin
 * (never a wildcard). The R2 client uses path-style URLs, so the bucket name is not part
 * of the host.
 */
const r2Origin = env.R2_ACCOUNT_ID ? ` https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "";

/**
 * S-9 Content Security Policy.
 *
 * Next.js App Router injects inline bootstrap scripts, so without per-request nonces
 * 'unsafe-inline' is required for scripts. Everything else is locked to this origin, and
 * framing, plugins and foreign form targets are blocked. A nonce-based policy (set in the
 * proxy) is a possible later hardening step. `'unsafe-eval'` and `ws:` are only for the
 * development server's hot reload and are never sent by a production build.
 *
 * TODO(before Phase 1): switch to a nonce-based CSP (per-request nonce generated in the
 * proxy, `'strict-dynamic'`) and drop `'unsafe-inline'` from script-src.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob:${r2Origin}`,
  "font-src 'self' data:",
  `connect-src 'self'${r2Origin}${isDev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Two years, all subdomains. Browsers ignore HSTS on plain-http responses (localhost dev).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
