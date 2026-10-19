import type { Session } from "next-auth";
import { redirect } from "next/navigation";
import { cache } from "react";

import { hasValidSession, unauthorizedJson } from "./access-policy";
import { auth } from "./auth";

/**
 * One session read per server request: a layout and its page both call requireSession(),
 * and each read may run the inventory-api re-check, so dedupe them.
 */
const readSession = cache(() => auth());

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export type AppSession = Session;

/**
 * S-2 / AUTH-6: call at the top of every server action and route handler. The proxy is not
 * trusted on its own (server actions can be invoked directly). Reading the session also runs
 * the expiry and hourly inventory-api re-check.
 *
 * Throws `UnauthorizedError` when there is no valid session.
 */
export async function requireSession(): Promise<AppSession> {
  const session = await readSession();
  if (!session || !hasValidSession(session)) throw new UnauthorizedError();
  return session;
}

/** For server components/layouts: redirects to /login instead of throwing. */
export async function requirePageSession(): Promise<AppSession> {
  try {
    return await requireSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect("/login");
    throw error;
  }
}

/**
 * For route handlers: `export const GET = withSession(async (request, session) => ...)`.
 * Responds 401 without calling the handler when there is no valid session.
 */
export function withSession<Args extends unknown[]>(
  handler: (session: AppSession, ...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let session: AppSession;
    try {
      session = await requireSession();
    } catch (error) {
      if (error instanceof UnauthorizedError) return unauthorizedJson();
      throw error;
    }
    return handler(session, ...args);
  };
}
