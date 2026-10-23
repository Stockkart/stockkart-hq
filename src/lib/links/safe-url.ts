import { z } from "zod";

import { isSafeHref } from "@/features/editor/safe-href";

/**
 * URLs people store outside rich text: service links and environment URLs (SVC-1), and any
 * later "link to X" field. Stricter than the editor's `isSafeHref` (which it reuses for the
 * scheme allowlist, S-8):
 *
 * - absolute `http:` / `https:` only (no `mailto:`, no relative paths, no `javascript:`,
 *   `data:`, `vbscript:` …);
 * - no credentials (`https://user:password@host`): the registry must never hold secrets;
 * - a host is required, the whole URL is ≤ 2048 characters, and no whitespace, control or
 *   invisible format characters (the URL parser would silently strip some of them, and
 *   zero-width or bidi characters make a link look like another).
 *
 * It does not refuse `localhost` or private addresses: these URLs are only shown as links.
 * Never fetch them from the server (that would be an SSRF vector) without an allowlist.
 *
 * Returns the normalised URL (`URL.href`), or null when the input is not acceptable.
 */
export const SAFE_URL_MAX = 2048;

const UNSAFE_CHARACTERS = /[\s\p{Cc}\p{Cf}]/u;

export function parseSafeUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0 || input.length > SAFE_URL_MAX) {
    return null;
  }
  if (UNSAFE_CHARACTERS.test(input) || !isSafeHref(input)) return null;
  let url: URL;
  try {
    // No base: relative URLs throw instead of resolving to some origin.
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.hostname === "") return null;
  return url.href.length > SAFE_URL_MAX ? null : url.href;
}

export function isSafeUrl(input: unknown): input is string {
  return parseSafeUrl(input) !== null;
}

/** Zod field for a stored link: trims, validates with `parseSafeUrl`, yields the normalised URL. */
export const safeUrlSchema = z
  .string()
  .trim()
  .max(SAFE_URL_MAX)
  .transform((value, context) => {
    const url = parseSafeUrl(value);
    if (url === null) {
      context.addIssue({
        code: "custom",
        message: "Enter a full http(s) URL without a username or password",
      });
      return z.NEVER;
    }
    return url;
  });
