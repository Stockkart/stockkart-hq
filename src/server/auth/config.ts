import type { NextAuthConfig, Session, User } from "next-auth";
import { CredentialsSignin } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";

import { createAuthorize, type AuthorizeDeps } from "./authorize";
import {
  claimsForNewSession,
  refreshSessionToken,
  SESSION_MAX_AGE_SECONDS,
} from "./session-policy";

export interface AuthConfigDeps extends AuthorizeDeps {
  secret: string;
  now?: () => number;
}

/**
 * Auth.js callbacks and events, built from injected dependencies so they can be unit tested
 * without a database or a running inventory-api.
 */
export function createAuthHandlers(deps: AuthConfigDeps) {
  const now = deps.now ?? (() => Date.now());

  /** `user` is only present at sign-in (it is what authorize() returned). */
  async function jwt({ token, user }: { token: JWT; user?: User }): Promise<JWT | null> {
    if (user) {
      if (!user.id || !user.stockkartUserId || !user.stockkartAccessToken) return null;
      return {
        ...token,
        ...claimsForNewSession(
          {
            hqUserId: user.id,
            stockkartUserId: user.stockkartUserId,
            stockkartAccessToken: user.stockkartAccessToken,
            sessionVersion: user.sessionVersion ?? 0,
            name: user.name ?? "",
            email: user.email ?? "",
          },
          now(),
        ),
      };
    }
    // Every later session read: absolute expiry + hourly inventory-api re-check (AUTH-4).
    return refreshSessionToken(token, deps.client, now());
  }

  /**
   * Builds the session from a small allowlist of claims. Always returning `user` here also
   * stops next-auth's server-side helper from falling back to the raw token (which holds the
   * Stockkart access token) as `session.user`.
   */
  function session({ session, token }: { session: { expires: string }; token: JWT }): Session {
    return {
      expires: session.expires,
      user: {
        id: typeof token.sub === "string" ? token.sub : "",
        name: typeof token.name === "string" ? token.name : "",
        email: typeof token.email === "string" ? token.email : "",
      },
    };
  }

  /** AUTH-7: ending the HQ session also drops the Stockkart token. */
  async function signOut(message: { token?: JWT | null } | { session?: unknown }): Promise<void> {
    const token = "token" in message ? message.token : null;
    if (token?.stockkartAccessToken) {
      await deps.client.logout(token.stockkartAccessToken);
    }
  }

  return { jwt, session, signOut };
}

export function buildAuthConfig(deps: AuthConfigDeps): NextAuthConfig {
  const handlers = createAuthHandlers(deps);

  return {
    secret: deps.secret,
    // Never enable debug: Auth.js debug logs include the credentials request body.
    debug: false,
    session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
    pages: { signIn: "/login", error: "/login" },
    providers: [
      Credentials({
        id: "credentials",
        name: "Stockkart account",
        credentials: { email: {}, password: {} },
        authorize: createAuthorize(deps),
      }),
    ],
    callbacks: { jwt: handlers.jwt, session: handlers.session },
    events: { signOut: handlers.signOut },
    logger: {
      error(error) {
        // Expected sign-in failures are not errors. For everything else log the name and
        // message only: `cause` can carry request details.
        if (error instanceof CredentialsSignin) return;
        console.error(`[auth] ${error.name}: ${error.message}`);
      },
      warn(code) {
        console.warn(`[auth] warning: ${code}`);
      },
      debug() {},
    },
  };
}
