import type { JWT } from "next-auth/jwt";

import { SUPER_USER_ROLE, type StockkartClient } from "./stockkart-client";

/** AUTH-4: re-check the Stockkart token/role at most once per hour per session. */
export const RECHECK_INTERVAL_MS = 60 * 60 * 1000;
/**
 * When inventory-api is down (5xx/timeout) the session is kept, but we retry sooner than an
 * hour. Without this back-off every request during an outage would wait for the timeout.
 */
export const RECHECK_RETRY_MS = 5 * 60 * 1000;
/** inventory-api access tokens are opaque and live 7 days, with no refresh endpoint. */
export const STOCKKART_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Safety margin so an HQ session never outlives the Stockkart token it relies on. */
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;
/** AUTH-3: Auth.js session max age (seconds), <= the Stockkart token lifetime. */
export const SESSION_MAX_AGE_SECONDS = (STOCKKART_TOKEN_TTL_MS - TOKEN_EXPIRY_MARGIN_MS) / 1000;

export interface SignedInIdentity {
  hqUserId: string;
  stockkartUserId: string;
  stockkartAccessToken: string;
  sessionVersion: number;
  name: string;
  email: string;
}

/** Claims written into the encrypted session JWT at sign-in. */
export function claimsForNewSession(identity: SignedInIdentity, now: number): JWT {
  return {
    sub: identity.hqUserId,
    name: identity.name,
    email: identity.email,
    stockkartUserId: identity.stockkartUserId,
    // Lives only inside the Auth.js-encrypted JWT (S-3a). Never copied into the session object.
    stockkartAccessToken: identity.stockkartAccessToken,
    // Auth.js JWT sessions slide: the cookie is re-issued with a fresh expiry on use. Pin an
    // absolute deadline tied to the Stockkart token so the session cannot outlive it.
    stockkartTokenExpiresAt: now + STOCKKART_TOKEN_TTL_MS - TOKEN_EXPIRY_MARGIN_MS,
    lastVerifiedAt: now,
    recheckAt: now + RECHECK_INTERVAL_MS,
    sessionVersion: identity.sessionVersion,
  };
}

/**
 * Runs on every session read (proxy, server components, server actions). Returns the token
 * to keep, possibly with updated timestamps, or `null` to end the session; Auth.js then
 * clears the cookie. In the proxy the re-issued cookie is written to the response, so a
 * successful re-check is persisted and the next check happens about an hour later.
 */
export async function refreshSessionToken(
  token: JWT,
  client: Pick<StockkartClient, "me" | "logout">,
  now: number,
): Promise<JWT | null> {
  const {
    sub,
    stockkartAccessToken,
    stockkartUserId,
    stockkartTokenExpiresAt,
    lastVerifiedAt,
    recheckAt,
  } = token;

  // A token without our claims (e.g. issued by an older build) is not trusted.
  if (
    typeof sub !== "string" ||
    typeof stockkartAccessToken !== "string" ||
    typeof stockkartUserId !== "string" ||
    typeof stockkartTokenExpiresAt !== "number" ||
    typeof lastVerifiedAt !== "number"
  ) {
    return null;
  }

  if (now >= stockkartTokenExpiresAt) return null;

  const nextCheck =
    typeof recheckAt === "number" ? recheckAt : lastVerifiedAt + RECHECK_INTERVAL_MS;
  if (now < nextCheck) return token;

  const result = await client.me(stockkartAccessToken);
  switch (result.kind) {
    case "ok": {
      if (result.user.userId !== stockkartUserId || result.user.role !== SUPER_USER_ROLE) {
        // The role was removed (or the token now maps to someone else). The token itself is
        // still live in inventory-api, so drop it there too; HQ access ends either way.
        await client.logout(stockkartAccessToken);
        return null;
      }
      return { ...token, lastVerifiedAt: now, recheckAt: now + RECHECK_INTERVAL_MS };
    }
    case "unauthorized":
      // 401/403: token expired, revoked or user disabled. End the session at once.
      return null;
    case "unavailable":
      // 5xx, timeout or network error: keep the session so HQ works while inventory-api is
      // down (AUTH-4), but try again in a few minutes. lastVerifiedAt is left unchanged.
      return { ...token, recheckAt: now + RECHECK_RETRY_MS };
  }
}
