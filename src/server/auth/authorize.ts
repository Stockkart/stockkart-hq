import type { User } from "next-auth";
import { z } from "zod";

import { SignInFailed } from "./errors";
import { clientIpFrom, type RateLimiter } from "./rate-limit";
import { SUPER_USER_ROLE, type StockkartClient } from "./stockkart-client";
import type { UserRepository } from "./users";

const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(1024),
});

export interface AuthorizeDeps {
  client: StockkartClient;
  limiter: RateLimiter;
  users: UserRepository;
}

/**
 * Credentials `authorize()` for Auth.js (AUTH-1, AUTH-2, AUTH-8).
 *
 * Throws `SignInFailed` with a client-safe code on every failure; never returns null, so the
 * login form always gets a specific (but non-revealing) message.
 */
export function createAuthorize(deps: AuthorizeDeps) {
  return async function authorize(
    rawCredentials: Partial<Record<string, unknown>>,
    request: Request,
  ): Promise<User> {
    const parsed = credentialsSchema.safeParse(rawCredentials);
    if (!parsed.success) throw new SignInFailed("invalid_credentials");
    const { email, password } = parsed.data;
    const ip = clientIpFrom(request.headers);

    // Rate limit before touching inventory-api. A limited caller sees the same generic
    // message as a wrong password, so the limiter does not reveal which emails exist.
    // If the limiter's database is unreachable we fail closed: nobody signs in.
    let limited: boolean;
    try {
      limited = await deps.limiter.isLimited(email, ip);
    } catch {
      console.error("[auth] rate limiter unavailable");
      throw new SignInFailed("unavailable");
    }
    if (limited) throw new SignInFailed("invalid_credentials");

    const login = await deps.client.login(email, password);

    if (login.kind === "unavailable") throw new SignInFailed("unavailable");

    if (login.kind === "invalid_credentials") {
      await recordFailureSafely(deps.limiter, email, ip);
      throw new SignInFailed("invalid_credentials");
    }

    if (login.user.role !== SUPER_USER_ROLE) {
      // Valid Stockkart account but not HQ staff. Drop the freshly issued token (each user
      // has a small cap of live tokens) and count this as a failure so the endpoint
      // cannot be used to probe roles without limit.
      await deps.client.logout(login.accessToken);
      await recordFailureSafely(deps.limiter, email, ip);
      throw new SignInFailed("access_denied");
    }

    try {
      const hqUser = await deps.users.upsertOnSignIn({
        stockkartUserId: login.user.userId,
        name: login.user.name?.trim() || login.user.email || email,
        email: login.user.email ?? email,
      });
      await deps.limiter.recordSuccess(email, ip);

      return {
        id: hqUser.id,
        name: hqUser.name,
        email: hqUser.email,
        stockkartUserId: login.user.userId,
        stockkartAccessToken: login.accessToken,
        sessionVersion: hqUser.sessionVersion,
      };
    } catch {
      // DB write failed after inventory-api issued a token: give the token back.
      console.error("[auth] could not record sign-in");
      await deps.client.logout(login.accessToken);
      throw new SignInFailed("unavailable");
    }
  };
}

async function recordFailureSafely(limiter: RateLimiter, email: string, ip: string) {
  try {
    await limiter.recordFailure(email, ip);
  } catch {
    console.error("[auth] could not record failed sign-in attempt");
  }
}
