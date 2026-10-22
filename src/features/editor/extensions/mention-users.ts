import { type MentionUser } from "@/lib/notifications/views";

/**
 * The @mention list's people (client-only). HQ is a small team, so the whole list is
 * fetched once per page load, on the first "@", and filtered locally while typing: no
 * request per keystroke.
 */

/** Suggestions shown at once. */
export const MENTION_SUGGESTIONS_MAX = 8;

export type LoadMentionUsers = () => Promise<MentionUser[]>;

let cached: Promise<MentionUser[]> | null = null;

/** The users, loaded once; a failed load is retried on the next "@". */
export function cachedMentionUsers(load: LoadMentionUsers): Promise<MentionUser[]> {
  if (!cached) {
    cached = load().catch(() => {
      cached = null;
      return [];
    });
  }
  return cached;
}

/** Test hook: forget the loaded list. */
export function resetMentionUsersCache(): void {
  cached = null;
}

/**
 * Users whose name or email contains `query` (case-insensitive), those whose name or a
 * word of it starts with it first, then by name.
 */
export function filterMentionUsers(
  users: readonly MentionUser[],
  query: string,
  max = MENTION_SUGGESTIONS_MAX,
): MentionUser[] {
  const q = query.trim().toLowerCase();
  const rank = (user: MentionUser): number => {
    if (q === "") return 0;
    const name = user.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.split(/\s+/).some((word) => word.startsWith(q))) return 1;
    if (name.includes(q) || user.email.toLowerCase().includes(q)) return 2;
    return -1;
  };
  return users
    .map((user) => ({ user, rank: rank(user) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.user.name.localeCompare(b.user.name))
    .slice(0, max)
    .map((entry) => entry.user);
}
