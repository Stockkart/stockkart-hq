import { type z } from "zod";

import { type ActionResult } from "@/lib/action-result";
import { FOREIGN_KEY_VIOLATION, pgErrorInfo, ServiceError } from "@/server/services/errors";

/**
 * Shared body of the server actions (not itself a server action: no "use server", so it can
 * never be called from the browser). The caller has ALREADY run `await requireSession()`.
 *
 * Validates the untrusted input, runs the service call, refreshes the affected pages and
 * maps expected failures to `{ ok: false, error }`. Anything else propagates.
 */
export async function runAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  action: (data: z.output<S>) => Promise<T>,
  refresh: () => void,
): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  try {
    const data = await action(parsed.data);
    refresh();
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ServiceError) return { ok: false, error: error.message };
    // A referenced user, component or issue was deleted between the check and the write.
    if (pgErrorInfo(error)?.code === FOREIGN_KEY_VIOLATION) {
      return { ok: false, error: "Something it refers to no longer exists; reload and retry" };
    }
    throw error;
  }
}
