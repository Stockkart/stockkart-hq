import { z } from "zod";

/**
 * Expected failures a service reports to its caller. Server actions turn these into
 * `{ ok: false, error }`; anything else is a bug and propagates.
 */
export class ServiceError extends Error {
  constructor(
    readonly code: "not_found" | "invalid" | "forbidden" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export const notFound = (what: string) => new ServiceError("not_found", `${what} not found`);
export const invalid = (message: string) => new ServiceError("invalid", message);
export const forbidden = (message: string) => new ServiceError("forbidden", message);
export const conflict = (message: string) => new ServiceError("conflict", message);

const pgErrorShape = z.object({ code: z.string(), constraint: z.string().optional() });

/**
 * Postgres error code and constraint name, if `error` (or one of its causes) is a Postgres
 * error. Drizzle wraps driver errors in `DrizzleQueryError`, with the driver's error as
 * `cause`; node-postgres and Neon both expose `code` and `constraint`.
 */
export function pgErrorInfo(error: unknown): { code: string; constraint?: string } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const parsed = pgErrorShape.safeParse(current);
    if (parsed.success && /^[0-9A-Z]{5}$/.test(parsed.data.code)) return parsed.data;
    current = current instanceof Error ? current.cause : undefined;
  }
  return null;
}

export const UNIQUE_VIOLATION = "23505";
