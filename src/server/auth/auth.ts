import NextAuth from "next-auth";

import { env } from "@/env";
import { db } from "@/server/db/client";

import { buildAuthConfig } from "./config";
import { createPostgresAttemptStore, createRateLimiter } from "./rate-limit";
import { createStockkartClient } from "./stockkart-client";
import { createUserRepository } from "./users";

// Wiring only. Importing `env` here means a missing STOCKKART_API_URL or AUTH_SECRET throws
// before Auth.js is created, so the app fails closed instead of running without auth.
export const { handlers, auth, signIn, signOut } = NextAuth(
  buildAuthConfig({
    secret: env.AUTH_SECRET,
    client: createStockkartClient({ baseUrl: env.STOCKKART_API_URL }),
    limiter: createRateLimiter(createPostgresAttemptStore(db)),
    users: createUserRepository(db),
  }),
);
