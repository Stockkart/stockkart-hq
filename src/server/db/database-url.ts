/**
 * DATABASE_URL checks shared by `src/env.ts` and the scripts (seed), which must not import
 * `@/env` because it also requires the auth variables.
 */

export const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `sslmode=require` or stronger (verify-ca / verify-full), unless the host is loopback. */
const TLS_SSL_MODES = new Set(["require", "verify-ca", "verify-full"]);

export function databaseUrlUsesTls(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (LOOPBACK_HOSTS.has(url.hostname)) return true;
  return TLS_SSL_MODES.has(url.searchParams.get("sslmode") ?? "");
}
