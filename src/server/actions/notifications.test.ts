import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceError } from "@/server/services/errors";

const authMock = vi.hoisted(() => vi.fn<() => Promise<Session | null>>());
vi.mock("@/server/auth/auth", () => ({ auth: authMock }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));
const notificationService = vi.hoisted(() => ({
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  setNotifyEmail: vi.fn(),
}));
const notificationQueries = vi.hoisted(() => ({ latest: vi.fn(), unreadCount: vi.fn() }));
const watcherService = vi.hoisted(() => ({ setWatching: vi.fn() }));
const mentionQueries = vi.hoisted(() => ({ mentionableUsers: vi.fn() }));
vi.mock("@/server/services", () => ({
  notificationService,
  notificationQueries,
  watcherService,
  mentionQueries,
}));

const {
  loadBellAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  setNotifyEmailAction,
} = await import("./notifications");
const { listMentionUsersAction, setWatchingAction } = await import("./watchers");
const { UnauthorizedError } = await import("@/server/auth/require-session");

const ME = "7d1a2c4e-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const SOMEONE = "11111111-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const NOTE = "22222222-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const ISSUE = "33333333-1f3b-4c5d-8e9f-0a1b2c3d4e5f";
const session: Session = {
  expires: new Date(Date.now() + 60_000).toISOString(),
  user: { id: ME, name: "Test Staff", email: "staff@example.test" },
};

const paths = () => revalidatePath.mock.calls.map(([path]) => path);

describe("notification and watcher actions (NTF-1, NTF-2, ISS-11)", () => {
  beforeEach(() => {
    authMock.mockReset();
    revalidatePath.mockReset();
    for (const fn of [
      ...Object.values(notificationService),
      ...Object.values(notificationQueries),
      ...Object.values(watcherService),
      ...Object.values(mentionQueries),
    ]) {
      fn.mockReset();
    }
    notificationQueries.latest.mockResolvedValue([]);
    notificationQueries.unreadCount.mockResolvedValue(4);
    notificationService.markRead.mockResolvedValue(undefined);
    notificationService.markAllRead.mockResolvedValue({ marked: 4 });
    notificationService.setNotifyEmail.mockResolvedValue({ notifyEmail: true });
    watcherService.setWatching.mockResolvedValue({ watching: true });
    mentionQueries.mentionableUsers.mockResolvedValue([]);
  });

  it.each([
    ["loadBellAction", () => loadBellAction()],
    ["markNotificationReadAction", () => markNotificationReadAction({ notificationId: NOTE })],
    ["markAllNotificationsReadAction", () => markAllNotificationsReadAction({ asOf: new Date() })],
    ["setNotifyEmailAction", () => setNotifyEmailAction({ enabled: true })],
    ["setWatchingAction", () => setWatchingAction({ issueId: ISSUE, watching: true })],
    ["listMentionUsersAction", () => listMentionUsersAction()],
  ])("%s refuses without a session and touches nothing", async (_name, call) => {
    authMock.mockResolvedValue(null);
    await expect(call()).rejects.toBeInstanceOf(UnauthorizedError);
    for (const fn of [
      ...Object.values(notificationService),
      ...Object.values(notificationQueries),
      ...Object.values(watcherService),
      ...Object.values(mentionQueries),
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("loads the SESSION user's latest 20 and unread count", async () => {
    authMock.mockResolvedValue(session);
    await expect(loadBellAction()).resolves.toEqual({
      ok: true,
      data: { items: [], unread: 4, asOf: expect.any(Date) },
    });
    expect(notificationQueries.latest).toHaveBeenCalledWith(ME, 20);
    expect(notificationQueries.unreadCount).toHaveBeenCalledWith(ME);
  });

  it("marks read as the session user only (a user id in the input is ignored)", async () => {
    authMock.mockResolvedValue(session);
    await expect(
      markNotificationReadAction({ notificationId: NOTE, userId: SOMEONE }),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(notificationService.markRead).toHaveBeenCalledWith(ME, NOTE);
    expect(paths()).toEqual(["/notifications"]);
    const asOf = new Date("2026-01-02T03:04:05Z");
    await expect(markAllNotificationsReadAction({ asOf, userId: SOMEONE })).resolves.toEqual({
      ok: true,
      data: { marked: 4 },
    });
    expect(notificationService.markAllRead).toHaveBeenCalledWith(ME, asOf);
    await expect(markAllNotificationsReadAction({ asOf: "soon" })).resolves.toMatchObject({
      ok: false,
    });
    expect(notificationService.markAllRead).toHaveBeenCalledTimes(1);
  });

  it("reports someone else's (or a missing) notification as not found", async () => {
    authMock.mockResolvedValue(session);
    notificationService.markRead.mockRejectedValue(
      new ServiceError("not_found", "Notification not found"),
    );
    await expect(markNotificationReadAction({ notificationId: NOTE })).resolves.toEqual({
      ok: false,
      error: "Notification not found",
    });
  });

  it.each([{}, { notificationId: "nope" }, null])(
    "rejects a bad notification id %j before the service",
    async (input) => {
      authMock.mockResolvedValue(session);
      await expect(markNotificationReadAction(input)).resolves.toMatchObject({ ok: false });
      expect(notificationService.markRead).not.toHaveBeenCalled();
    },
  );

  it("stores the email opt-in for the session user, and validates it", async () => {
    authMock.mockResolvedValue(session);
    await expect(setNotifyEmailAction({ enabled: true, userId: SOMEONE })).resolves.toEqual({
      ok: true,
      data: { notifyEmail: true },
    });
    expect(notificationService.setNotifyEmail).toHaveBeenCalledWith(ME, true);
    expect(paths()).toEqual(["/settings/profile"]);
    await expect(setNotifyEmailAction({ enabled: "yes" })).resolves.toMatchObject({ ok: false });
    expect(notificationService.setNotifyEmail).toHaveBeenCalledTimes(1);
  });

  it("watches as the session user and refreshes the issue page", async () => {
    authMock.mockResolvedValue(session);
    await expect(
      setWatchingAction({ issueId: ISSUE, watching: true, userId: SOMEONE }),
    ).resolves.toEqual({ ok: true, data: { watching: true } });
    expect(watcherService.setWatching).toHaveBeenCalledWith(ME, { issueId: ISSUE, watching: true });
    expect(paths()).toEqual(["/[projectKey]/issues/[key]"]);
    await expect(setWatchingAction({ issueId: "x", watching: true })).resolves.toMatchObject({
      ok: false,
    });
    expect(watcherService.setWatching).toHaveBeenCalledTimes(1);
  });
});
