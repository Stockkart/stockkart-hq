import { afterAll, beforeAll, expect, it } from "vitest";

import { githubLoginInput } from "@/lib/github/schemas";
import { type AppDatabase } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { ServiceError } from "./errors";
import { createProfileService } from "./profile";

/** GH-4 profile GitHub username: set, clear, unique case-insensitively (Postgres). */
describeDb("profile (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let alice: string;
  let bob: string;
  const service = () => createProfileService(db);
  const set = (userId: string, githubLogin: string) =>
    service().setGithubLogin(userId, githubLoginInput.parse({ githubLogin }));

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    alice = await createTestUser(db, "Alice");
    bob = await createTestUser(db, "Bob");
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("sets, reads back and clears the username", async () => {
    expect(await set(alice, "@Imf-Ali")).toEqual({ githubLogin: "Imf-Ali" });
    expect(await service().get(alice)).toMatchObject({ name: "Alice", githubLogin: "Imf-Ali" });
    expect(await set(alice, "")).toEqual({ githubLogin: null });
    expect((await service().get(alice))?.githubLogin).toBeNull();
  });

  it("is unique across HQ users, ignoring case", async () => {
    await set(alice, "octocat");
    const taken = set(bob, "OctoCat");
    await expect(taken).rejects.toBeInstanceOf(ServiceError);
    await expect(set(bob, "OCTOCAT")).rejects.toMatchObject({ code: "conflict" });
    // Re-saving your own name in another case is fine, and two users may both have none.
    expect(await set(alice, "OctoCat")).toEqual({ githubLogin: "OctoCat" });
    await set(alice, "");
    expect(await set(bob, "octocat")).toEqual({ githubLogin: "octocat" });
  });

  it("reports a missing user", async () => {
    await expect(set("00000000-0000-4000-8000-000000000000", "ghost")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
