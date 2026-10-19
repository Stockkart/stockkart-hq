import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Phase 0 schema: only what sign-in needs (SPEC §8). Everything else arrives in Phase 1.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** HQ user, created on first sign-in and keyed by the Stockkart (inventory-api) userId. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  stockkartUserId: text("stockkart_user_id").notNull().unique(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  avatarUrl: text("avatar_url"),
  githubLogin: text("github_login"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  // S-3: "sign out everywhere" (P1) bumps this; sessions carrying an older value are rejected.
  sessionVersion: integer("session_version").notNull().default(0),
  ...timestamps,
});

/**
 * AUTH-8 rate limiting. One row per sign-in attempt per key, where key is
 * `email:<normalised email>` or `ip:<client ip>`.
 */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    success: boolean("success").notNull(),
  },
  (table) => [index("login_attempts_key_attempted_at_idx").on(table.key, table.attemptedAt)],
);

export type UserRow = typeof users.$inferSelect;
