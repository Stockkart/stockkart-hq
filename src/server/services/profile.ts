import { eq, sql } from "drizzle-orm";

import { type GithubLoginInput } from "@/lib/github/schemas";
import { directRead, type Read } from "@/server/db/read-batch";
import { users } from "@/server/db/schema";
import { type AppDatabase } from "@/server/db/types";

import { conflict, notFound, pgErrorInfo, UNIQUE_VIOLATION } from "./errors";

export interface ProfileView {
  name: string;
  email: string;
  githubLogin: string | null;
}

/**
 * The signed-in user's own profile. Every query is scoped to `userId`, which the action takes
 * from the session, never from the input.
 */
export function createProfileService(db: AppDatabase, { read = directRead }: { read?: Read } = {}) {
  return {
    async get(userId: string): Promise<ProfileView | null> {
      const [row] = await read(
        db
          .select({ name: users.name, email: users.email, githubLogin: users.githubLogin })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1),
      );
      return row ?? null;
    },

    /**
     * GH-4: sets (or clears, with null) the user's GitHub username. Unique across HQ users,
     * case-insensitively: the `lower(github_login)` unique index decides, so two users
     * claiming the same name at once cannot both win.
     */
    async setGithubLogin(
      userId: string,
      input: GithubLoginInput,
    ): Promise<{ githubLogin: string | null }> {
      try {
        const [row] = await db
          .update(users)
          .set({ githubLogin: input.githubLogin, updatedAt: sql`now()` })
          .where(eq(users.id, userId))
          .returning({ githubLogin: users.githubLogin });
        if (!row) throw notFound("User");
        return row;
      } catch (error) {
        const info = pgErrorInfo(error);
        if (info?.code === UNIQUE_VIOLATION && info.constraint === "users_github_login_unique") {
          throw conflict("Another HQ user already has that GitHub username");
        }
        throw error;
      }
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;
