/**
 * S-8: only these link schemes are ever rendered or accepted by the editor. Anything else
 * (`javascript:`, `data:`, `vbscript:` …) is dropped and the text is shown without a link.
 */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function isSafeHref(href: unknown): href is string {
  if (typeof href !== "string" || href.length > 2048) return false;
  try {
    // A base makes relative URLs parse; they resolve to this origin, which is safe.
    return SAFE_PROTOCOLS.has(new URL(href, "https://hq.invalid").protocol);
  } catch {
    return false;
  }
}
