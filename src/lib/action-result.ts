/** What every mutating server action returns. Isomorphic (used by client components). */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
