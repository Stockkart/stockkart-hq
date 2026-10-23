import { SERVICE_SLUG_MAX, SERVICE_SLUG_PATTERN } from "./constants";

/**
 * SVC-1 service slugs (`/STK/services/<slug>`). Isomorphic: the form pre-fills the slug from
 * the name with this, and the server derives it the same way when none is sent.
 */

/** Used when a name has no ASCII letters or digits at all. */
export const FALLBACK_SERVICE_SLUG = "service";

/** "MongoDB Atlas" → `mongodb-atlas`; cut at a word boundary to ≤ 64 characters. */
export function serviceSlug(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > SERVICE_SLUG_MAX) {
      if (!slug) slug = word.slice(0, SERVICE_SLUG_MAX);
      break;
    }
    slug = next;
  }
  return slug || FALLBACK_SERVICE_SLUG;
}

export function isServiceSlug(value: string): boolean {
  return value.length <= SERVICE_SLUG_MAX && SERVICE_SLUG_PATTERN.test(value);
}

/**
 * The n-th candidate for an auto slug: `base`, then `base-2`, `base-3` … (the base is cut
 * so the suffix still fits the 64-character limit).
 */
export function slugCandidate(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const suffix = `-${attempt}`;
  const head = base.slice(0, SERVICE_SLUG_MAX - suffix.length).replace(/-+$/, "");
  return `${head || FALLBACK_SERVICE_SLUG}${suffix}`;
}

/** `/STK/services` and `/STK/services/<slug>`. */
export function servicesPath(projectKey: string): string {
  return `/${projectKey}/services`;
}

export function servicePath(projectKey: string, slug: string): string {
  return `/${projectKey}/services/${slug}`;
}
