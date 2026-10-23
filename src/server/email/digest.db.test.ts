import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { emailDeliveries, loginAttempts, notifications, users } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { type AppDatabase, transactionRunner } from "@/server/db/types";
import { createNotificationQueries } from "@/server/services/notification-queries";
import { createNotificationService } from "@/server/services/notifications";
import { createTestDatabase, createTestUser, describeDb, type TestDatabase } from "@/test/db";

import { createDigestJob } from "./digest";
import { type EmailMessage, type SendEmail } from "./resend";
import { hashToken } from "./tokens";
import { createUnsubscribeService, MAX_FAILURES_PER_IP } from "./unsubscribe";

const BASE = "https://hq.example.test";
const HOUR = 60 * 60 * 1000;

/** NTF-2 digest job and unsubscribe against Postgres (HQ_DB_TESTS=1); Resend is faked. */
describeDb("email digest (Postgres)", () => {
  let testDb: TestDatabase;
  let db: AppDatabase;
  let ada: string;
  let actor: string;
  let docEntity: string;
  const sent: EmailMessage[] = [];
  let reply: SendEmail;

  const job = (now: Date) =>
    createDigestJob({
      db,
      notificationQueries: createNotificationQueries(db),
      send: (message) => reply(message),
      config: { from: "HQ <hq@mail.example.test>", baseUrl: BASE },
      now: () => now,
      log: () => undefined,
    });

  async function notify(userId: string, at: Date, read = false) {
    await db.insert(notifications).values({
      userId,
      type: "comment_on_doc",
      entityType: "doc",
      entityId: docEntity,
      actorId: actor,
      createdAt: at,
      readAt: read ? at : null,
    });
  }

  async function optIn(userId: string, lastDigestAt: Date | null, frequency: "daily" | "weekly") {
    await db
      .update(users)
      .set({ notifyEmail: true, lastDigestAt, digestFrequency: frequency })
      .where(eq(users.id, userId));
  }

  const deliveriesOf = (userId: string) =>
    db.select().from(emailDeliveries).where(eq(emailDeliveries.userId, userId));
  const userRow = async (userId: string) =>
    (await db.select().from(users).where(eq(users.id, userId)))[0];

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    await seed(db);
    actor = await createTestUser(db, "Actor");
    docEntity = crypto.randomUUID();
  });

  beforeEach(async () => {
    sent.length = 0;
    reply = async (message) => {
      sent.push(message);
      return { ok: true, providerId: `msg_${sent.length}` };
    };
    // Each test starts with only its own users opted in.
    await db.update(users).set({ notifyEmail: false });
    ada = await createTestUser(db, "Ada");
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it("sends the period's unread notifications, then marks it sent and moves the period", async () => {
    const now = new Date("2026-10-20T01:30:00Z");
    const last = new Date(now.getTime() - 25 * HOUR);
    await optIn(ada, last, "daily");
    await notify(ada, new Date(last.getTime() - HOUR)); // before the period
    await notify(ada, new Date(now.getTime() - 2 * HOUR));
    await notify(ada, new Date(now.getTime() - HOUR), true); // read
    await notify(ada, new Date(now.getTime() - 3 * HOUR));

    expect(await job(now).run()).toMatchObject({ due: 1, sent: 1 });
    expect(sent).toHaveLength(1);
    const [message] = sent;
    expect(message?.subject).toBe("Stockkart HQ: 2 unread notifications");
    expect(message?.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const token = /token=([A-Za-z0-9_-]{43})>/.exec(
      message?.headers["List-Unsubscribe"] ?? "",
    )?.[1];
    expect(token).toBeDefined();
    const [delivery] = await deliveriesOf(ada);
    expect(delivery).toMatchObject({ status: "sent", providerId: "msg_1", errorCode: null });
    expect(delivery?.sentAt).toBeInstanceOf(Date);
    expect(delivery?.periodStart).toEqual(last);
    const after = await userRow(ada);
    expect(after?.lastDigestAt).toEqual(now);
    // Only the hash of the emailed token is stored.
    expect(after?.emailUnsubscribeTokenHash).toBe(hashToken(token ?? ""));

    // The next day's run starts where this one ended and rotates the token.
    const tomorrow = new Date(now.getTime() + 24 * HOUR);
    await notify(ada, new Date(tomorrow.getTime() - HOUR));
    await job(tomorrow).run();
    expect(sent).toHaveLength(2);
    expect((await userRow(ada))?.emailUnsubscribeTokenHash).not.toBe(
      after?.emailUnsubscribeTokenHash,
    );
  });

  it("skips (and moves the period) when there is nothing unread, without emailing", async () => {
    const now = new Date("2026-10-20T01:30:00Z");
    await optIn(ada, new Date(now.getTime() - 24 * HOUR), "daily");
    expect(await job(now).run()).toMatchObject({ due: 1, skipped: 1, sent: 0 });
    expect(sent).toHaveLength(0);
    const [delivery] = await deliveriesOf(ada);
    expect(delivery).toMatchObject({ status: "skipped", sentAt: null });
    expect((await userRow(ada))?.lastDigestAt).toEqual(now);
    expect((await userRow(ada))?.emailUnsubscribeTokenHash).toBeNull();
  });

  it("does nothing for users who are not due (daily too recent, weekly not on Monday)", async () => {
    const tuesday = new Date("2026-10-20T01:30:00Z");
    const bo = await createTestUser(db, "Bo");
    await optIn(ada, new Date(tuesday.getTime() - 5 * HOUR), "daily");
    await optIn(bo, new Date(tuesday.getTime() - 8 * 24 * HOUR), "weekly");
    await notify(ada, new Date(tuesday.getTime() - HOUR));
    await notify(bo, new Date(tuesday.getTime() - HOUR));
    expect(await job(tuesday).run()).toMatchObject({ due: 0 });
    expect(sent).toHaveLength(0);
    // Monday: the weekly one is due.
    const monday = new Date("2026-10-26T01:30:00Z");
    await db.update(users).set({ notifyEmail: false }).where(eq(users.id, ada));
    expect(await job(monday).run()).toMatchObject({ due: 1, sent: 1 });
  });

  it("claims a period once: two concurrent runs send one email", async () => {
    const now = new Date("2026-10-20T01:30:00Z");
    await optIn(ada, new Date(now.getTime() - 24 * HOUR), "daily");
    await notify(ada, new Date(now.getTime() - HOUR));
    // Slow sends, so both runs are in flight at once.
    reply = async (message) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      sent.push(message);
      return { ok: true, providerId: "msg_once" };
    };
    const [first, second] = await Promise.all([job(now).run(), job(now).run()]);
    expect(sent).toHaveLength(1);
    expect(first.sent + second.sent).toBe(1);
    expect(first.busy + second.busy).toBe(1);
    expect(await deliveriesOf(ada)).toHaveLength(1);
  });

  it("records a failure with its code only, keeps the period, and retries it next run", async () => {
    const now = new Date("2026-10-20T01:30:00Z");
    const last = new Date(now.getTime() - 24 * HOUR);
    await optIn(ada, last, "daily");
    await notify(ada, new Date(now.getTime() - HOUR));
    reply = async () => ({ ok: false, errorCode: "validation_error" });
    expect(await job(now).run()).toMatchObject({ failed: 1 });
    const [failed] = await deliveriesOf(ada);
    expect(failed).toMatchObject({ status: "failed", errorCode: "validation_error", sentAt: null });
    expect((await userRow(ada))?.lastDigestAt).toEqual(last);

    reply = async (message) => {
      sent.push(message);
      return { ok: true, providerId: "msg_retry" };
    };
    const later = new Date(now.getTime() + 24 * HOUR);
    expect(await job(later).run()).toMatchObject({ sent: 1 });
    const [retried] = await deliveriesOf(ada);
    expect(retried).toMatchObject({ id: failed?.id, status: "sent", errorCode: null });
    expect((await userRow(ada))?.lastDigestAt).toEqual(later);
  });

  it("does not steal a fresh pending claim, but reclaims a stale one", async () => {
    const now = new Date("2026-10-20T01:30:00Z");
    const last = new Date(now.getTime() - 24 * HOUR);
    await optIn(ada, last, "daily");
    await notify(ada, new Date(now.getTime() - HOUR));
    await db.insert(emailDeliveries).values({
      userId: ada,
      kind: "digest",
      periodStart: last,
      periodEnd: now,
      status: "pending",
    });
    expect(await job(now).run()).toMatchObject({ busy: 1 });
    expect(sent).toHaveLength(0);
    await db
      .update(emailDeliveries)
      .set({ updatedAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(emailDeliveries.userId, ada));
    expect(await job(now).run()).toMatchObject({ sent: 1 });
  });

  it("keeps the old unsubscribe link working when a send fails", async () => {
    const now = new Date("2026-10-20T01:30:00Z");
    await optIn(ada, new Date(now.getTime() - 24 * HOUR), "daily");
    await db
      .update(users)
      .set({ emailUnsubscribeTokenHash: hashToken("old") })
      .where(eq(users.id, ada));
    await notify(ada, new Date(now.getTime() - HOUR));
    reply = async () => ({ ok: false, errorCode: "http_500" });
    await job(now).run();
    expect((await userRow(ada))?.emailUnsubscribeTokenHash).toBe(hashToken("old"));
  });

  it("never marks an accepted email failed when recording it hiccups once", async () => {
    const now = new Date("2026-10-20T01:30:00Z");
    await optIn(ada, new Date(now.getTime() - 24 * HOUR), "daily");
    await notify(ada, new Date(now.getTime() - HOUR));
    const flaky = createNotificationQueries(db);
    // Statements: the claim (1st execute), then `finish` (2nd) fails once and is retried.
    const original = db.execute.bind(db);
    const spy = vi
      .spyOn(db, "execute")
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error("transient"));
    try {
      const result = await createDigestJob({
        db,
        notificationQueries: flaky,
        send: async (message) => {
          sent.push(message);
          return { ok: true, providerId: "msg_flaky" };
        },
        config: { from: "HQ <hq@mail.example.test>", baseUrl: BASE },
        now: () => now,
        log: () => undefined,
      }).run();
      expect(result).toMatchObject({ sent: 1, failed: 0 });
    } finally {
      spy.mockRestore();
    }
    const [delivery] = await deliveriesOf(ada);
    expect(delivery).toMatchObject({ status: "sent", providerId: "msg_flaky" });
  });

  it("retries a failed weekly digest on the next run, not only on Mondays", async () => {
    const monday = new Date("2026-10-19T01:30:00Z");
    await optIn(ada, new Date(monday.getTime() - 7 * 24 * HOUR), "weekly");
    await notify(ada, new Date(monday.getTime() - HOUR));
    reply = async () => ({ ok: false, errorCode: "http_500" });
    expect(await job(monday).run()).toMatchObject({ failed: 1 });
    reply = async (message) => {
      sent.push(message);
      return { ok: true, providerId: "msg_tue" };
    };
    const tuesday = new Date(monday.getTime() + 24 * HOUR);
    expect(await job(tuesday).run()).toMatchObject({ due: 1, sent: 1 });
    // Sent: the next Tuesday is not due again.
    expect(await job(new Date(tuesday.getTime() + 24 * HOUR)).run()).toMatchObject({ due: 0 });
  });

  it("leaves users for the next run once its time budget is used", async () => {
    const now = new Date("2026-10-20T01:30:00Z");
    const bo = await createTestUser(db, "Bo");
    await optIn(ada, new Date(now.getTime() - 24 * HOUR), "daily");
    await optIn(bo, new Date(now.getTime() - 24 * HOUR), "daily");
    const result = await createDigestJob({
      db,
      notificationQueries: createNotificationQueries(db),
      send: (message) => reply(message),
      config: { from: "HQ <hq@mail.example.test>", baseUrl: BASE },
      now: () => now,
      budgetMs: -1,
      log: () => undefined,
    }).run();
    expect(result).toMatchObject({ due: 2, deferred: 2, skipped: 0 });
    expect(await deliveriesOf(ada)).toHaveLength(0);
  });

  it("turning the digest on starts the period then (no backlog), and sets the cadence", async () => {
    const service = createNotificationService(db);
    await notify(ada, new Date(Date.now() - 48 * HOUR));
    await service.setNotifyEmail(ada, true);
    const opted = await userRow(ada);
    expect(opted?.lastDigestAt?.getTime()).toBeGreaterThan(Date.now() - 60_000);
    // Turning it on again keeps the period.
    await service.setNotifyEmail(ada, true);
    expect((await userRow(ada))?.lastDigestAt).toEqual(opted?.lastDigestAt);
    expect(await service.setDigestFrequency(ada, "weekly")).toEqual({ digestFrequency: "weekly" });
    expect(await createNotificationQueries(db).digestSettings(ada)).toEqual({
      notifyEmail: true,
      digestFrequency: "weekly",
    });
  });

  it("unsubscribes by token hash, idempotently; unknown tokens change nothing", async () => {
    const unsubscribe = createUnsubscribeService(db, { runAtomic: transactionRunner(db) });
    const token = "T".repeat(42) + "k";
    await optIn(ada, null, "daily");
    await db
      .update(users)
      .set({ emailUnsubscribeTokenHash: hashToken(token) })
      .where(eq(users.id, ada));

    expect(await unsubscribe.unsubscribe("U".repeat(43), "198.51.100.1")).toBe("done");
    expect((await userRow(ada))?.notifyEmail).toBe(true);
    expect(await unsubscribe.unsubscribe("not a token", "198.51.100.1")).toBe("done");

    expect(await unsubscribe.unsubscribe(token, "198.51.100.1")).toBe("done");
    expect((await userRow(ada))?.notifyEmail).toBe(false);
    expect(await unsubscribe.unsubscribe(token, "198.51.100.1")).toBe("done");
    expect((await userRow(ada))?.notifyEmail).toBe(false);
  });

  it("rate limits unsubscribe attempts per IP", async () => {
    const unsubscribe = createUnsubscribeService(db, { runAtomic: transactionRunner(db) });
    const ip = "192.0.2.77";
    const outcomes = await Promise.all(
      Array.from({ length: MAX_FAILURES_PER_IP + 5 }, () => unsubscribe.unsubscribe("bad", ip)),
    );
    expect(outcomes.filter((outcome) => outcome === "rate_limited")).toHaveLength(5);
    // Another IP has its own budget.
    expect(await unsubscribe.unsubscribe("bad", "192.0.2.78")).toBe("done");
    const rows = await db
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.key, `unsubscribe-ip:${ip}`));
    expect(rows).toHaveLength(MAX_FAILURES_PER_IP);
  });
});
