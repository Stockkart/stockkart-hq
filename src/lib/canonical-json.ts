/**
 * JSON with object keys sorted, so two values compare equal regardless of key order (Postgres
 * `jsonb` reorders keys, so a stored doc and the editor's copy of it differ only in order).
 * Isomorphic.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );
}
