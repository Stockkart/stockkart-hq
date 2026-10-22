/**
 * Merges per-feature registries (`{ nodeType: entry }` objects) into one Map. Parallel
 * slices each add a line to a registry, so a node type registered twice is a merge mistake:
 * it throws at module load (and so in every test run) instead of one entry silently
 * winning. A Map, not an object, so a stored type such as "constructor" never matches a
 * prototype key. Isomorphic.
 */
export function mergeRegistries<T>(
  what: string,
  sources: readonly Readonly<Record<string, T>>[],
): ReadonlyMap<string, T> {
  const merged = new Map<string, T>();
  for (const source of sources) {
    for (const [key, entry] of Object.entries(source)) {
      if (merged.has(key)) throw new Error(`${what}: "${key}" is registered twice`);
      merged.set(key, entry);
    }
  }
  return merged;
}
