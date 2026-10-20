import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { issues, projects, todos } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { ServiceError } from "./errors";
import { createIssueService } from "./issues";
import { createTodoService } from "./todos";

/** MY-2 todos and MY-3 promote against real Postgres. */
describeDb("todos (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let alice: string;
  let bob: string;
  const service = () => createTodoService(db);
  const issueService = () => createIssueService(db, { runAtomic: transactionRunner(db) });

  const texts = async (userId: string) => (await service().list(userId)).map((todo) => todo.text);

  async function counter(): Promise<number> {
    const [row] = await db
      .select({ counter: projects.issueCounter })
      .from(projects)
      .where(eq(projects.key, "STK"));
    return row?.counter ?? -1;
  }

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    alice = await createTestUser(db, "Alice");
    bob = await createTestUser(db, "Bob");
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("adds at the bottom, edits, checks off and reorders", async () => {
    const one = await service().add(alice, { text: "one" });
    const two = await service().add(alice, { text: "two" });
    const three = await service().add(alice, { text: "three" });
    expect(await texts(alice)).toEqual(["one", "two", "three"]);

    await service().move(alice, { todoId: three.id, afterTodoId: null });
    expect(await texts(alice)).toEqual(["three", "one", "two"]);
    await service().move(alice, { todoId: three.id, afterTodoId: two.id });
    expect(await texts(alice)).toEqual(["one", "two", "three"]);
    await service().move(alice, { todoId: one.id, afterTodoId: two.id });
    expect(await texts(alice)).toEqual(["two", "one", "three"]);

    await service().edit(alice, { todoId: two.id, text: "two!" });
    await service().setDone(alice, { todoId: one.id, done: true });
    const list = await service().list(alice);
    expect(list.find((todo) => todo.id === two.id)?.text).toBe("two!");
    expect(list.find((todo) => todo.id === one.id)?.done).toBe(true);

    await service().remove(alice, three.id);
    expect(await texts(alice)).toEqual(["two!", "one"]);
  });

  describe("ownership isolation", () => {
    it("never shows, changes, moves or deletes another user's todo", async () => {
      const secret = await service().add(bob, { text: "bob's secret" });
      const mine = await service().add(alice, { text: "alice's own" });

      expect(await texts(alice)).not.toContain("bob's secret");
      const attempts = await Promise.allSettled([
        service().edit(alice, { todoId: secret.id, text: "hacked" }),
        service().setDone(alice, { todoId: secret.id, done: true }),
        service().move(alice, { todoId: secret.id, afterTodoId: null }),
        // Using someone else's todo as the anchor leaks nothing either.
        service().move(alice, { todoId: mine.id, afterTodoId: secret.id }),
        service().remove(alice, secret.id),
      ]);
      for (const attempt of attempts) {
        // Same answer as for an id that does not exist: ids reveal nothing.
        expect(attempt).toMatchObject({
          status: "rejected",
          reason: expect.objectContaining({ message: "Todo not found" }),
        });
      }
      const [row] = await db.select().from(todos).where(eq(todos.id, secret.id));
      expect(row).toMatchObject({ text: "bob's secret", done: false, userId: bob });
      expect(await texts(bob)).toEqual(["bob's secret"]);
    });

    it("refuses to promote another user's todo and creates no issue", async () => {
      const secret = await service().add(bob, { text: "bob's promotable" });
      const before = await counter();
      await expect(
        issueService().createIssue(
          alice,
          { projectKey: "STK", title: "stolen", type: "task", priority: 2 },
          { promoteTodoId: secret.id },
        ),
      ).rejects.toBeInstanceOf(ServiceError);
      expect(await counter()).toBe(before);
      const [row] = await db.select().from(todos).where(eq(todos.id, secret.id));
      expect(row?.promotedIssueId).toBeNull();
    });
  });

  it("promotes a todo to an issue once and shows the key on the todo", async () => {
    const todo = await service().add(alice, { text: "Write the outbox runbook" });
    const create = () =>
      issueService().createIssue(
        alice,
        { projectKey: "STK", title: "Write the outbox runbook", type: "task", priority: 2 },
        { promoteTodoId: todo.id },
      );
    const before = await counter();
    // A double click: both race, exactly one issue is created and linked.
    const results = await Promise.allSettled([create(), create()]);
    const created = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    expect(created).toHaveLength(1);
    expect(await counter()).toBe(before + 1);

    const [issue] = await db
      .select()
      .from(issues)
      .where(eq(issues.id, created[0]?.id ?? ""));
    expect(issue).toMatchObject({ title: "Write the outbox runbook", reporterId: alice });
    const view = (await service().list(alice)).find((row) => row.id === todo.id);
    expect(view?.promotedIssue).toEqual({
      key: created[0]?.key,
      href: `/STK/issues/${created[0]?.key}`,
    });

    // Already promoted: a second attempt is refused and allocates nothing.
    await expect(create()).rejects.toThrow("already promoted");
    expect(await counter()).toBe(before + 1);
  });
});
