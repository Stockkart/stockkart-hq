import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { savedViews } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createSavedViewService } from "./saved-views";
import { projectIdByKey } from "./sql";

/** VW-3 against real Postgres (HQ_DB_TESTS=1): privacy is in every query. */
describeDb("saved views (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let ada: string;
  let bo: string;
  const service = () => createSavedViewService(db);
  const stk = () => projectIdByKey("STK");

  const save = (userId: string, name: string, shared: boolean, query = "?priority=0,1") =>
    service().create(userId, { projectKey: "STK", name, shared, query });

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    ada = await createTestUser(db, "Ada");
    bo = await createTestUser(db, "Bo");
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("stores the URL filters canonically (unknown or invalid params dropped)", async () => {
    const { id } = await save(
      ada,
      "Open P0/P1 bugs",
      false,
      "?type=bug,nope&priority=1,0,9&assignee=me&utm=x&sort=priority&dir=asc&view=abc",
    );
    const [row] = await db.select().from(savedViews).where(eq(savedViews.id, id));
    expect(row?.filter).toEqual({
      type: "bug",
      priority: "1,0",
      assignee: "me",
      sort: "priority",
      dir: "asc",
    });
    await expect(save(ada, "Open P0/P1 bugs", true)).rejects.toMatchObject({ code: "conflict" });
  });

  it("never lets anyone else read, change or reorder a private view", async () => {
    const { id } = await save(ada, "Ada's private", false);
    expect((await service().listViews(bo, stk())).map((v) => v.id)).not.toContain(id);
    expect(await service().getView(bo, id)).toBeNull();
    const notFound = { code: "not_found" };
    await expect(service().rename(bo, { viewId: id, name: "Mine now" })).rejects.toMatchObject(
      notFound,
    );
    await expect(service().updateFilter(bo, { viewId: id, query: "" })).rejects.toMatchObject(
      notFound,
    );
    await expect(service().setShared(bo, { viewId: id, shared: true })).rejects.toMatchObject(
      notFound,
    );
    await expect(service().move(bo, { viewId: id, afterViewId: null })).rejects.toMatchObject(
      notFound,
    );
    await expect(service().remove(bo, id)).rejects.toMatchObject(notFound);
    const [row] = await db.select().from(savedViews).where(eq(savedViews.id, id));
    expect(row).toMatchObject({ name: "Ada's private", shared: false });
    expect(await service().getView(ada, id)).toMatchObject({ id, mine: true });
  });

  it("shows shared views to everyone, read-only for non-owners", async () => {
    const { id } = await save(ada, "Team view", true);
    const seenByBo = await service().listViews(bo, stk());
    expect(seenByBo.find((v) => v.id === id)).toMatchObject({
      mine: false,
      shared: true,
      ownerName: "Ada",
    });
    await expect(service().remove(bo, id)).rejects.toMatchObject({ code: "not_found" });
    // Unsharing hides it again.
    await service().setShared(ada, { viewId: id, shared: false });
    expect((await service().listViews(bo, stk())).map((v) => v.id)).not.toContain(id);
  });

  it("lists own views in their order first, then shared ones; reorders, renames, updates", async () => {
    const one = (await save(bo, "One", false)).id;
    const two = (await save(bo, "Two", true)).id;
    const three = (await save(bo, "Three", false)).id;
    const mine = async () =>
      (await service().listViews(bo, stk())).filter((v) => v.mine).map((v) => v.name);
    expect(await mine()).toEqual(["One", "Two", "Three"]);
    await service().move(bo, { viewId: three, afterViewId: null });
    expect(await mine()).toEqual(["Three", "One", "Two"]);
    await service().move(bo, { viewId: three, afterViewId: one });
    expect(await mine()).toEqual(["One", "Three", "Two"]);

    const adaView = (await save(ada, "Anchor", true)).id;
    const list = await service().listViews(bo, stk());
    expect(list.findIndex((v) => v.id === adaView)).toBeGreaterThan(
      list.findLastIndex((v) => v.mine),
    );

    await service().rename(bo, { viewId: two, name: "Second" });
    await expect(service().rename(bo, { viewId: two, name: "One" })).rejects.toMatchObject({
      code: "conflict",
    });
    await service().updateFilter(bo, { viewId: two, query: "status=bogus&q=outbox" });
    expect((await service().getView(bo, two))?.filter).toEqual({ q: "outbox" });

    await service().remove(bo, one);
    expect(await mine()).toEqual(["Three", "Second"]);
    // Someone else's view as the anchor is not found.
    await expect(service().move(bo, { viewId: three, afterViewId: adaView })).rejects.toMatchObject(
      { code: "not_found" },
    );
  });
});
