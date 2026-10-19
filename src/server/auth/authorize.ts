import type { User } from "next-auth";
import { z } from "zod";

import { SignInFailed } from "./errors";
import { clientIpFrom, type LoginAttemptReservation, type RateLimiter } from "./rate-limit";
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
    //
    // The attempt is *reserved* (recorded as a failure, atomically with the limit check)
    // before inventory-api is called, so parallel requests cannot all slip past the check
    // before any failure is written. From here on the attempt counts as a failure unless
    // it succeeds (`succeeded()`) or never got a verdict (`release()`).
    let reservation: LoginAttemptReservation | null;
    try {
      reservation = await deps.limiter.reserve(email, ip);
    } catch {
      console.error("[auth] rate limiter unavailable");
      throw new SignInFailed("unavailable");
    }
    if (!reservation) throw new SignInFailed("invalid_credentials");

    const login = await deps.client.login(email, password);

    if (login.kind === "unavailable") {
      // inventory-api gave no verdict on the password, so this is not a failed guess.
      await releaseSafely(reservation);
      throw new SignInFailed("unavailable");
    }

    // Already counted by the reservation.
    if (login.kind === "invalid_credentials") throw new SignInFailed("invalid_credentials");

    if (login.user.role !== SUPER_USER_ROLE) {
      // Valid Stockkart account but not HQ staff. Drop the freshly issued token (each user
      // has a small cap of live tokens). The reservation stays a failure so the endpoint
      // cannot be used to probe roles without limit.
      await deps.client.logout(login.accessToken);
      throw new SignInFailed("access_denied");
    }

    try {
      const hqUser = await deps.users.upsertOnSignIn({
        stockkartUserId: login.user.userId,
        name: login.user.name?.trim() || login.user.email || email,
        email: login.user.email ?? email,
      });
      await reservation.succeeded();

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
      await releaseSafely(reservation);
      throw new SignInFailed("unavailable");
    }
  };
}

async function releaseSafely(reservation: LoginAttemptReservation) {
  try {
    await reservation.release();
  } catch {
    // The attempt then stays counted as a failure, which errs on the side of limiting.
    console.error("[auth] could not release sign-in attempt reservation");
  }
}
