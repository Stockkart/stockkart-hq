/**
 * `Promise.all` for checks that run together (one batched round trip) but must fail in a
 * fixed order: waits for every promise, then throws the FIRST rejection in array order
 * rather than whichever happened to settle first. So "Issue not found" still wins over
 * "Status not found" for a deleted issue, exactly as when the checks ran one by one.
 */
export async function allInOrder<T extends readonly unknown[] | []>(
  promises: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const settled = await Promise.allSettled(promises);
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
  }
  return Promise.all(promises);
}
