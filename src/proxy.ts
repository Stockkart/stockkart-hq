import { handleRequest } from "@/server/auth/access-policy";
import { auth } from "@/server/auth/auth";

/**
 * Default-deny gate for every request (S-1). Next.js 16 renamed `middleware.ts` to
 * `proxy.ts`; this file is the "middleware.ts" of SPEC §7.2/§7.6.
 *
 * Wrapping with Auth.js `auth()` decodes the session cookie and runs the `jwt` callback, so
 * the hourly inventory-api re-check happens here and any re-issued or cleared session
 * cookie is written onto this response.
 */
export default auth(handleRequest);

export const config = {
  // Run on everything except Next.js build assets and the two root static files.
  // The policy in access-policy.ts re-checks these exclusions, so the matcher is only an
  // optimisation, never the security boundary.
  matcher: ["/((?!_next/static/|_next/image/|favicon\\.ico$|robots\\.txt$).*)"],
};
