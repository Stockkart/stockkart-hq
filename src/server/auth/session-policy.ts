import type { JWT } from "next-auth/jwt";

import { SUPER_USER_ROLE, type StockkartClient } from "./stockkart-client";
import type { UserRepository } from "./users";

/** AUTH-4: re-check the Stockkart token/role and S-3 session version at most once per hour. */
export const RECHECK_INTERVAL_MS = 60 * 60 * 1000;
/**
 * When inventory-api is down (5xx/timeout) the session is kept, but we retry sooner than an
 * hour. Without this back-off every request during an outage would wait for the timeout.
 */
export const RECHECK_RETRY_MS = 5 * 60 * 1000;
/**
 * Hard ceiling: a session that has not been successfully re-checked (inventory-api /auth/me
 * plus the DB session_version) for this long ends, even while inventory-api is down.
 */
export const MAX_UNVERIFIED_MS = 24 * 60 * 60 * 1000;
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
  deps: {
    client: Pick<StockkartClient, "me" | "logout">;
    users: Pick<UserRepository, "getSessionVersion">;
  },
  now: number,
): Promise<JWT | null> {
  const { client, users } = deps;
  const {
    sub,
    stockkartAccessToken,
    stockkartUserId,
    stockkartTokenExpiresAt,
    lastVerifiedAt,
    recheckAt,
    sessionVersion,
  } = token;

  // A token without our claims (e.g. issued by an older build) is not trusted.
  if (
    typeof sub !== "string" ||
    typeof stockkartAccessToken !== "string" ||
    typeof stockkartUserId !== "string" ||
    typeof stockkartTokenExpiresAt !== "number" ||
    typeof lastVerifiedAt !== "number" ||
    typeof sessionVersion !== "number"
  ) {
    return null;
  }

  if (now >= stockkartTokenExpiresAt) return null;

  const nextCheck =
    typeof recheckAt === "number" ? recheckAt : lastVerifiedAt + RECHECK_INTERVAL_MS;
  if (now < nextCheck) return token;

  // Both checks run in parallel so the re-check costs one round trip. A DB error is folded
  // into "unavailable" here; getSessionVersion never decides anything by throwing.
  const [result, storedVersion] = await Promise.all([
    client.me(stockkartAccessToken),
    users.getSessionVersion(sub).then(
      (version): { kind: "ok"; version: number | null } => ({ kind: "ok", version }),
      (): { kind: "unavailable" } => {
        console.warn("[auth] session re-check: could not read session_version");
        return { kind: "unavailable" };
      },
    ),
  ]);

  // S-3: "sign out everywhere" bumps users.session_version; a session carrying an older
  // value (or whose HQ user is gone) ends here, and its Stockkart token is dropped too.
  if (storedVersion.kind === "ok" && storedVersion.version !== sessionVersion) {
    await client.logout(stockkartAccessToken);
    return null;
  }

  switch (result.kind) {
    case "ok": {
      if (result.user.userId !== stockkartUserId || result.user.role !== SUPER_USER_ROLE) {
        // The role was removed (or the token now maps to someone else). The token itself is
        // still live in inventory-api, so drop it there too; HQ access ends either way.
        await client.logout(stockkartAccessToken);
        return null;
      }
      // Only a fully successful check (inventory-api and the DB) counts as verified.
      if (storedVersion.kind === "ok") {
        return { ...token, lastVerifiedAt: now, recheckAt: now + RECHECK_INTERVAL_MS };
      }
      return keepUnverified(token, lastVerifiedAt, stockkartAccessToken, client, now);
    }
    case "unauthorized":
      // 401/403: token expired, revoked or user disabled. End the session at once.
      return null;
    case "unavailable":
      // 5xx, timeout, network error or an unexpected body: keep the session so HQ works
      // while inventory-api is down (AUTH-4), but try again in a few minutes. lastVerifiedAt
      // is left unchanged, so this counts toward the MAX_UNVERIFIED_MS ceiling.
      return keepUnverified(token, lastVerifiedAt, stockkartAccessToken, client, now);
  }
}

/**
 * A re-check that could not complete (inventory-api or the DB unavailable). The session is
 * kept with lastVerifiedAt unchanged and a short retry, until MAX_UNVERIFIED_MS has passed
 * since the last successful check; then it ends, so an outage (or an inventory-api that
 * keeps returning bodies we cannot parse) cannot keep a revoked session alive for days.
 */
async function keepUnverified(
  token: JWT,
  lastVerifiedAt: number,
  stockkartAccessToken: string,
  client: Pick<StockkartClient, "logout">,
  now: number,
): Promise<JWT | null> {
  if (now - lastVerifiedAt >= MAX_UNVERIFIED_MS) {
    console.warn("[auth] session ended: not verified for 24 hours");
    // Best effort (never throws); inventory-api may well be down.
    await client.logout(stockkartAccessToken);
    return null;
  }
  return { ...token, recheckAt: now + RECHECK_RETRY_MS };
}
