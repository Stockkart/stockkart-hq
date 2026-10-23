import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";

import { parseCostRoute } from "@/lib/costs/route";
import { createCostItemInput } from "@/lib/costs/schemas";
import { MY_WORK_MENTIONS } from "@/lib/notifications/schemas";
import { createBatchedRead, type Read } from "@/server/db/read-batch";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";
import { appLayoutReads } from "@/test/page-reads";

import { costPageReads } from "./cost-pages";
import { createCostQueries, createCostService } from "./costs";
import { createIssueQueries } from "./issue-queries";
import { createMentionQueries } from "./mentions";
import { createPlanningQueries } from "./planning-queries";
import { projectIdByKey } from "./sql";

/**
 * README "Performance": every costs tab, and My Work with its COST-7 card, loads in ONE
 * database round trip (see sprint-pages.db.test.ts for how flushes are counted). Each block
 * starts exactly the reads its page (plus the app layout) starts.
 */
describeDb("round trips of the costs pages (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let lead: string;
  // A date well after the items were created, past the reminder day.
  const today = { date: "2031-03-10", month: "2031-03" as const };

  function counted(): { read: Read; trips: () => number } {
    let flushes = 0;
    const read = createBatchedRead(
      () => Promise.reject(new Error("count only: run each query alone")),
      (flush) => {
        flushes += 1;
        setImmediate(flush);
      },
    );
    return { read, trips: () => flushes };
  }

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    lead = await createTestUser(db, "Lena Lead");
    await db.execute(sql`UPDATE projects SET lead_id = ${lead}::uuid WHERE key = 'STK'`);
    await createCostService(db, { runAtomic: transactionRunner(db) }).createItem(
      lead,
      createCostItemInput.parse({
        projectKey: "STK",
        name: "Vercel",
        vendor: "Vercel",
        category: "hosting",
        billingCycle: "monthly",
        currency: "USD",
        expectedAmountMinor: null,
        renewsOn: null,
        serviceId: null,
        notes: "",
      }),
    );
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it.each([[{}], [{ tab: "year", year: "2031" }], [{ tab: "items" }], [{ tab: "settings" }]])(
    "costs page %j: one round trip, with the reminder banner",
    async (params) => {
      const { read, trips } = counted();
      const route = parseCostRoute(params, today.month);
      const [, , , , project, [items, , settings, reminder, services, users]] = await Promise.all([
        ...appLayoutReads(db, read, lead),
        createIssueQueries(db, { read }).getProject("STK"),
        Promise.all(
          costPageReads(createCostQueries(db, { read }), projectIdByKey("STK"), route, today),
        ),
      ]);
      expect(trips()).toBe(1);
      expect(project?.key).toBe("STK");
      expect(items.map((item) => item.name)).toEqual(["Vercel"]);
      expect(settings.leadId).toBe(lead);
      expect(reminder).toEqual({ projectKey: "STK", month: "2031-02", missingCount: 1 });
      expect(services).toEqual([]);
      expect(users.map((user) => user.id)).toContain(lead);
    },
  );

  it("My Work with the cost reminder card: one round trip", async () => {
    const { read, trips } = counted();
    const planning = createPlanningQueries(db, { read });
    const [, , , , , , , cards] = await Promise.all([
      ...appLayoutReads(db, read, lead),
      planning.listAssignedTo(lead),
      planning.listRecentlyViewed(lead),
      createMentionQueries(db, { read }).listMentionsOf(lead, MY_WORK_MENTIONS),
      createCostQueries(db, { read }).remindersFor(lead, today.date),
    ]);
    expect(trips()).toBe(1);
    expect(cards).toEqual([{ projectKey: "STK", month: "2031-02", missingCount: 1 }]);
  });
});
