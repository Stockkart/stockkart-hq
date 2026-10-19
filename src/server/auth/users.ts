import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/server/db/client";
import { users } from "@/server/db/schema";

export interface HqUser {
  id: string;
  name: string;
  email: string;
  sessionVersion: number;
}

export interface UpsertUserInput {
  stockkartUserId: string;
  name: string;
  email: string;
}

export interface UserRepository {
  /** Creates the HQ user on first sign-in, otherwise refreshes name/email/last_login_at. */
  upsertOnSignIn(input: UpsertUserInput): Promise<HqUser>;
  /**
   * S-3: the user's current `session_version`, or `null` if the HQ user no longer exists.
   * Throws when the database is unreachable.
   */
  getSessionVersion(hqUserId: string): Promise<number | null>;
}

export function createUserRepository(db: Database): UserRepository {
  return {
    async upsertOnSignIn({ stockkartUserId, name, email }) {
      const now = new Date();
      const [row] = await db
        .insert(users)
        .values({ stockkartUserId, name, email, lastLoginAt: now })
        .onConflictDoUpdate({
          target: users.stockkartUserId,
          set: { name, email, lastLoginAt: now, updatedAt: now },
        })
        .returning({
          id: users.id,
          name: users.name,
          email: users.email,
          sessionVersion: users.sessionVersion,
        });
      if (!row) throw new Error("users upsert returned no row");
      return row;
    },

    async getSessionVersion(hqUserId) {
      // Not a uuid means no such user (and would otherwise be a Postgres cast error).
      if (!z.uuid().safeParse(hqUserId).success) return null;
      const [row] = await db
        .select({ sessionVersion: users.sessionVersion })
        .from(users)
        .where(eq(users.id, hqUserId))
        .limit(1);
      return row?.sessionVersion ?? null;
    },
  };
}
