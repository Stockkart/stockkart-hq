import { beforeEach, describe, expect, it, vi } from "vitest";

import { type MentionUser } from "@/lib/notifications/views";

import { cachedMentionUsers, filterMentionUsers, resetMentionUsersCache } from "./mention-users";

const user = (name: string, email: string): MentionUser => ({
  id: crypto.randomUUID(),
  name,
  email,
  avatarUrl: null,
});
const USERS = [
  user("Grace Hopper", "grace@example.test"),
  user("Ada Lovelace", "ada@example.test"),
  user("Bob Adams", "bob@example.test"),
];
const names = (users: MentionUser[]) => users.map((entry) => entry.name);

describe("filterMentionUsers", () => {
  it("lists everyone by name for an empty query", () => {
    expect(names(filterMentionUsers(USERS, ""))).toEqual([
      "Ada Lovelace",
      "Bob Adams",
      "Grace Hopper",
    ]);
  });

  it("ranks name prefixes, then word prefixes, then any name or email match", () => {
    expect(names(filterMentionUsers(USERS, "ad"))).toEqual(["Ada Lovelace", "Bob Adams"]);
    expect(names(filterMentionUsers(USERS, "GRACE@"))).toEqual(["Grace Hopper"]);
    expect(filterMentionUsers(USERS, "zzz")).toEqual([]);
  });

  it("caps the list", () => {
    expect(filterMentionUsers(USERS, "", 2)).toHaveLength(2);
  });
});

describe("cachedMentionUsers", () => {
  beforeEach(() => resetMentionUsersCache());

  it("loads once, and retries after a failed load", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(USERS);
    await expect(cachedMentionUsers(load)).resolves.toEqual([]);
    await expect(cachedMentionUsers(load)).resolves.toEqual(USERS);
    await cachedMentionUsers(load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
